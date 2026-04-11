package services

import (
	"archive/tar"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"appcenter/models"
)

func parseFPKFile(fpkPath string, baseDir string) (models.App, error) {
	var app models.App
	app.ID = strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")

	relPath, err := filepath.Rel(baseDir, fpkPath)
	if err != nil || strings.HasPrefix(relPath, "..") {
		app.DownloadURL = filepath.Base(fpkPath)
	} else {
		app.DownloadURL = relPath
	}

	if info, err := os.Stat(fpkPath); err == nil {
		sizeMB := float64(info.Size()) / 1024 / 1024
		app.Size = fmt.Sprintf("%.2f", sizeMB)
	}

	isInstalled := false
	cmd := exec.Command("appcenter-cli", "list")
	output, err := cmd.Output()
	if err == nil {
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, app.ID) {
				isInstalled = true
				break
			}
		}
	}

	file, err := os.Open(fpkPath)
	if err != nil {
		return app, fmt.Errorf("cannot open FPK file: %v", err)
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return app, fmt.Errorf("invalid gzip format: %v", err)
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	manifestData := make(map[string]string)
	hasManifest := false

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("Failed to read tar entry in %s: %v", fpkPath, err)
			break
		}

		if header.Name == "manifest" {
			hasManifest = true
			data, err := ioutil.ReadAll(tarReader)
			if err != nil {
				log.Printf("Failed to read manifest in %s: %v", fpkPath, err)
				continue
			}

			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					key := strings.TrimSpace(parts[0])
					value := strings.TrimSpace(parts[1])
					manifestData[key] = value
				}
			}
		} else if header.Name == "ui/images/icon-256.png" || header.Name == "ICON_256.PNG" || header.Name == "icon-256.png" {
			iconData, err := ioutil.ReadAll(tarReader)
			if err == nil && len(iconData) > 0 {
				iconBase64 := base64.StdEncoding.EncodeToString(iconData)
				app.Icon = "data:image/png;base64," + iconBase64
			}
		} else if header.Name == "ui/images/icon-64.png" || header.Name == "ICON_64.PNG" || header.Name == "icon-64.png" {
			if app.Icon == "" {
				iconData, err := ioutil.ReadAll(tarReader)
				if err == nil && len(iconData) > 0 {
					iconBase64 := base64.StdEncoding.EncodeToString(iconData)
					app.Icon = "data:image/png;base64," + iconBase64
				}
			}
		}

		if header.Size > 1024*1024*10 {
			io.CopyN(io.Discard, tarReader, header.Size)
		}
	}

	if !hasManifest {
		return app, fmt.Errorf("manifest not found in FPK")
	}

	if displayName, ok := manifestData["display_name"]; ok && displayName != "" {
		app.Name = displayName
	} else if appname, ok := manifestData["appname"]; ok && appname != "" {
		app.Name = appname
	} else {
		app.Name = app.ID
	}

	if version, ok := manifestData["version"]; ok && version != "" {
		app.Version = version
	} else {
		app.Version = "unknown"
	}

	if platform, ok := manifestData["platform"]; ok && platform != "" {
		app.Platform = platform
	} else {
		app.Platform = "x86"
	}

	if desc, ok := manifestData["desc"]; ok && desc != "" {
		app.Description = desc
	} else if description, ok := manifestData["description"]; ok && description != "" {
		app.Description = description
	} else {
		app.Description = "FPK 应用包"
	}

	if maintainer, ok := manifestData["maintainer"]; ok && maintainer != "" {
		app.Author = maintainer
	} else if author, ok := manifestData["author"]; ok && author != "" {
		app.Author = author
	}

	if distributor, ok := manifestData["distributor"]; ok && distributor != "" {
		app.Publisher = distributor
	} else if publisher, ok := manifestData["publisher"]; ok && publisher != "" {
		app.Publisher = publisher
	}

	if labels, ok := manifestData["labels"]; ok && labels != "" {
		app.Labels = strings.Split(labels, ",")
		for i := range app.Labels {
			app.Labels[i] = strings.TrimSpace(app.Labels[i])
		}
	} else if categories, ok := manifestData["categories"]; ok && categories != "" {
		app.Labels = strings.Split(categories, ",")
		for i := range app.Labels {
			app.Labels[i] = strings.TrimSpace(app.Labels[i])
		}
	} else {
		app.Labels = []string{"其他"}
	}
	app.Categories = app.Labels

	app.IsInstalled = isInstalled

	return app, nil
}
