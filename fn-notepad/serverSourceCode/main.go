package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

var (
	unixSocket = flag.String("unix-socket", "/var/apps/notepad/var/notepad.sock", "Unix socket path")
	dataDir    = flag.String("data-dir", "/var/apps/notepad/var", "Data storage directory")
	db         *sql.DB
)

type Note struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Color     string `json:"color"`
	Pinned    bool   `json:"pinned"`
	Reminder  string `json:"reminder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

func main() {
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	dbPath := filepath.Join(*dataDir, "notepad.db")
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	if err := initDatabase(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Try to migrate old JSON data
	migrateOldData()

	http.HandleFunc("/api/get-notes", getNotesHandler)
	http.HandleFunc("/api/save-note", saveNoteHandler)
	http.HandleFunc("/api/delete-note", deleteNoteHandler)
	http.HandleFunc("/api/batch-delete", batchDeleteHandler)
	http.HandleFunc("/api/export-notes", exportNotesHandler)
	
	// Keep old handler for backward compatibility during transition if needed
	http.HandleFunc("/api/save-notes", saveNotesCompatibilityHandler)

	if _, err := os.Stat(*unixSocket); err == nil {
		os.Remove(*unixSocket)
	}

	listener, err := net.Listen("unix", *unixSocket)
	if err != nil {
		log.Fatalf("Failed to listen on unix socket: %v", err)
	}
	os.Chmod(*unixSocket, 0666)

	log.Printf("Starting notepad backend (SQLite) on %s", *unixSocket)
	http.Serve(listener, nil)
}

func initDatabase() error {
	query := `
	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY,
		title TEXT,
		content TEXT,
		color TEXT,
		pinned INTEGER,
		reminder TEXT,
		createdAt INTEGER,
		updatedAt INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_updatedAt ON notes(updatedAt);
	`
	_, err := db.Exec(query)
	return err
}

func migrateOldData() {
	jsonPath := filepath.Join(*dataDir, "notes.json")
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		return
	}

	log.Println("Migrating old JSON data to SQLite...")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return
	}

	var notes []Note
	if err := json.Unmarshal(data, &notes); err != nil {
		log.Printf("Failed to parse old JSON: %v", err)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		return
	}

	stmt, _ := tx.Prepare("INSERT OR REPLACE INTO notes (id, title, content, color, pinned, reminder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
	for _, n := range notes {
		pinned := 0
		if n.Pinned {
			pinned = 1
		}
		stmt.Exec(n.ID, n.Title, n.Content, n.Color, pinned, n.Reminder, n.CreatedAt, n.UpdatedAt)
	}
	tx.Commit()

	// Rename old file
	os.Rename(jsonPath, jsonPath+".bak")
	log.Printf("Migration complete. %d notes imported.", len(notes))
}

func getNotesHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	filter := r.URL.Query().Get("filter")
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 30
	}

	sqlQuery := "SELECT id, title, content, color, pinned, reminder, createdAt, updatedAt FROM notes WHERE 1=1"
	args := []interface{}{}

	if query != "" {
		sqlQuery += " AND (title LIKE ? OR content LIKE ?)"
		args = append(args, "%"+query+"%", "%"+query+"%")
	}

	if filter == "pinned" {
		sqlQuery += " AND pinned = 1"
	} else if filter == "reminder" {
		sqlQuery += " AND reminder != '' AND reminder IS NOT NULL"
	}

	sqlQuery += " ORDER BY updatedAt DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var n Note
		var pinned int
		rows.Scan(&n.ID, &n.Title, &n.Content, &n.Color, &pinned, &n.Reminder, &n.CreatedAt, &n.UpdatedAt)
		n.Pinned = pinned == 1
		notes = append(notes, n)
	}

	w.Header().Set("Content-Type", "application/json")
	if notes == nil {
		w.Write([]byte("[]"))
	} else {
		json.NewEncoder(w).Encode(notes)
	}
}

func saveNoteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var n Note
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if n.CreatedAt == 0 {
		n.CreatedAt = n.UpdatedAt
	}

	pinned := 0
	if n.Pinned {
		pinned = 1
	}

	_, err := db.Exec("INSERT OR REPLACE INTO notes (id, title, content, color, pinned, reminder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		n.ID, n.Title, n.Content, n.Color, pinned, n.Reminder, n.CreatedAt, n.UpdatedAt)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}

func deleteNoteHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("DELETE FROM notes WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"success"}`))
}

func batchDeleteHandler(w http.ResponseWriter, r *http.Request) {
	var ids []int64
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if len(ids) == 0 {
		w.Write([]byte(`{"status":"success"}`))
		return
	}

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf("DELETE FROM notes WHERE id IN (%s)", strings.Join(placeholders, ","))
	_, err := db.Exec(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(`{"status":"success"}`))
}

func saveNotesCompatibilityHandler(w http.ResponseWriter, r *http.Request) {
	// For backward compatibility: handles the full array save
	var notes []Note
	if err := json.NewDecoder(r.Body).Decode(&notes); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	tx, _ := db.Begin()
	// This is inefficient but maintains compatibility during frontend update
	for _, n := range notes {
		pinned := 0
		if n.Pinned {
			pinned = 1
		}
		tx.Exec("INSERT OR REPLACE INTO notes (id, title, content, color, pinned, reminder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			n.ID, n.Title, n.Content, n.Color, pinned, n.Reminder, n.CreatedAt, n.UpdatedAt)
	}
	tx.Commit()

	w.Write([]byte(`{"status":"success"}`))
}
func exportNotesHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, title, content, color, pinned, reminder, createdAt, updatedAt FROM notes ORDER BY updatedAt DESC")
	if (err != nil) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var n Note
		var pinned int
		rows.Scan(&n.ID, &n.Title, &n.Content, &n.Color, &pinned, &n.Reminder, &n.CreatedAt, &n.UpdatedAt)
		n.Pinned = pinned == 1
		notes = append(notes, n)
	}

	w.Header().Set("Content-Type", "application/json")
	if notes == nil {
		w.Write([]byte("[]"))
	} else {
		json.NewEncoder(w).Encode(notes)
	}
}
