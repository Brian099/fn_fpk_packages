package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"

	"golang.org/x/crypto/pbkdf2"
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
	IsPrivate bool   `json:"isPrivate"`
	Password  string `json:"password,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type BackupFile struct {
	Version     int    `json:"version"`
	IsEncrypted bool   `json:"isEncrypted"`
	Salt        string `json:"salt,omitempty"`
	Nonce       string `json:"nonce,omitempty"`
	Payload     string `json:"payload"` // Base64 encoded JSON or ciphertext
}

func deriveKey(password string, salt []byte) []byte {
	// Add a static salt "notepad" to strengthen the key derivation
	combinedPassword := password + "notepad"
	return pbkdf2.Key([]byte(combinedPassword), salt, 100000, 32, sha256.New)
}

func encryptData(data []byte, password string) (*BackupFile, error) {
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	key := deriveKey(password, salt)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nil, nonce, data, nil)

	return &BackupFile{
		Version:     1,
		IsEncrypted: true,
		Salt:        base64.StdEncoding.EncodeToString(salt),
		Nonce:       base64.StdEncoding.EncodeToString(nonce),
		Payload:     base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

func decryptData(bf *BackupFile, password string) ([]byte, error) {
	salt, err := base64.StdEncoding.DecodeString(bf.Salt)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(bf.Nonce)
	if err != nil {
		return nil, err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(bf.Payload)
	if err != nil {
		return nil, err
	}

	key := deriveKey(password, salt)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
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
	http.HandleFunc("/api/lock-note", lockNoteHandler)
	http.HandleFunc("/api/verify-note", verifyNoteHandler)
	
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
		isPrivate INTEGER DEFAULT 0,
		password TEXT,
		createdAt INTEGER,
		updatedAt INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_updatedAt ON notes(updatedAt);
	`
	_, err := db.Exec(query)
	if err != nil {
		return err
	}

	// Migration for existing databases: try to add columns if they don't exist
	db.Exec("ALTER TABLE notes ADD COLUMN isPrivate INTEGER DEFAULT 0")
	db.Exec("ALTER TABLE notes ADD COLUMN password TEXT")

	return nil
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

	sqlQuery := "SELECT id, title, content, color, pinned, reminder, isPrivate, createdAt, updatedAt FROM notes WHERE 1=1"
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
		var isPrivate int
		rows.Scan(&n.ID, &n.Title, &n.Content, &n.Color, &pinned, &n.Reminder, &isPrivate, &n.CreatedAt, &n.UpdatedAt)
		n.Pinned = pinned == 1
		n.IsPrivate = isPrivate == 1
		if n.IsPrivate {
			n.Content = ""
			n.Password = ""
		}
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
	isPrivate := 0
	if n.IsPrivate {
		isPrivate = 1
	}

	// Use ON CONFLICT to avoid overwriting password if it's not provided for an existing private note
	query := `
	INSERT INTO notes (id, title, content, color, pinned, reminder, isPrivate, password, createdAt, updatedAt)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		title=excluded.title,
		content=excluded.content,
		color=excluded.color,
		pinned=excluded.pinned,
		reminder=excluded.reminder,
		isPrivate=excluded.isPrivate,
		password=CASE WHEN excluded.isPrivate = 1 AND (excluded.password = '' OR excluded.password IS NULL) THEN notes.password ELSE excluded.password END,
		updatedAt=excluded.updatedAt
	`
	_, err := db.Exec(query, n.ID, n.Title, n.Content, n.Color, pinned, n.Reminder, isPrivate, n.Password, n.CreatedAt, n.UpdatedAt)

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
	// For backward compatibility and importing backups
	var bf BackupFile
	var notes []map[string]interface{}
	
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Read failed", http.StatusInternalServerError)
		return
	}

	if err := json.Unmarshal(body, &bf); err != nil || (bf.Version == 0 && bf.Payload == "") {
		// Try to parse as old format (direct array)
		if err := json.Unmarshal(body, &notes); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
	} else {
		// New format
		var data []byte
		if bf.IsEncrypted {
			password := r.URL.Query().Get("password")
			if password == "" {
				http.Error(w, "Password required", http.StatusUnauthorized)
				return
			}
			decrypted, err := decryptData(&bf, password)
			if err != nil {
				http.Error(w, "Decryption failed", http.StatusUnauthorized)
				return
			}
			data = decrypted
		} else {
			decoded, err := base64.StdEncoding.DecodeString(bf.Payload)
			if err != nil {
				http.Error(w, "Decode failed", http.StatusBadRequest)
				return
			}
			data = decoded
		}
		if err := json.Unmarshal(data, &notes); err != nil {
			http.Error(w, "Invalid internal JSON", http.StatusBadRequest)
			return
		}
	}

	tx, _ := db.Begin()
	for _, n := range notes {
		// Dynamically build the insert query based on map keys
		columns := []string{}
		placeholders := []string{}
		args := []interface{}{}
		updateParts := []string{}
		
		for k, v := range n {
			columns = append(columns, k)
			placeholders = append(placeholders, "?")
			args = append(args, v)
			// Special handling for password to match saveNoteHandler logic if we want to be safe, 
			// but for import, we usually want to overwrite.
			if k == "password" {
				updateParts = append(updateParts, "password=CASE WHEN excluded.isPrivate = 1 AND (excluded.password = '' OR excluded.password IS NULL) THEN notes.password ELSE excluded.password END")
			} else if k != "id" {
				updateParts = append(updateParts, fmt.Sprintf("%s=excluded.%s", k, k))
			}
		}

		query := fmt.Sprintf("INSERT INTO notes (%s) VALUES (%s) ON CONFLICT(id) DO UPDATE SET %s", 
			strings.Join(columns, ","), 
			strings.Join(placeholders, ","),
			strings.Join(updateParts, ","))
			
		tx.Exec(query, args...)
	}
	tx.Commit()

	w.Write([]byte(`{"status":"success"}`))
}
func exportNotesHandler(w http.ResponseWriter, r *http.Request) {
	password := r.URL.Query().Get("password")

	rows, err := db.Query("SELECT * FROM notes ORDER BY updatedAt DESC")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var notes []map[string]interface{}
	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			continue
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columns[i]
			// SQLite returns int64 for integers, we keep it as is
			m[colName] = val
		}
		notes = append(notes, m)
	}

	jsonData, err := json.Marshal(notes)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if password == "" {
		http.Error(w, "Backup password is required for security", http.StatusBadRequest)
		return
	}

	bf, err := encryptData(jsonData, password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(bf)
}

func lockNoteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID       int64  `json:"id"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("UPDATE notes SET isPrivate = 1, password = ?, updatedAt = ? WHERE id = ?",
		req.Password, time.Now().UnixMilli(), req.ID)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"success"}`))
}

func verifyNoteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID       int64  `json:"id"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	var n Note
	var pinned int
	var isPrivate int
	var dbPassword string

	err := db.QueryRow("SELECT id, title, content, color, pinned, reminder, isPrivate, password, createdAt, updatedAt FROM notes WHERE id = ?", req.ID).
		Scan(&n.ID, &n.Title, &n.Content, &n.Color, &pinned, &n.Reminder, &isPrivate, &dbPassword, &n.CreatedAt, &n.UpdatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Note not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	if dbPassword != req.Password {
		http.Error(w, "Incorrect password", http.StatusUnauthorized)
		return
	}

	n.Pinned = pinned == 1
	n.IsPrivate = isPrivate == 1
	n.Password = "" // Don't send the password back

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(n)
}
