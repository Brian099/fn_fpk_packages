package services

import (
	"archive/tar"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	"appcenter/models"
)

func ParseFPKFile(fpkPath string, baseDir string) (models.App, error) {
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

	if appname, ok := manifestData["appname"]; ok && appname != "" {
		app.AppName = appname
	} else {
		app.AppName = app.ID
	}

	if displayName, ok := manifestData["display_name"]; ok && displayName != "" {
		app.Name = displayName
	} else if app.AppName != "" {
		app.Name = app.AppName
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

	return app, nil
}

// ExtractWizardConfig 提取向导配置和 License
func ExtractWizardConfig(fpkPath string, isUpdate bool) (models.WizardConfig, error) {
	var config models.WizardConfig

	file, err := os.Open(fpkPath)
	if err != nil {
		return config, err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return config, err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	targetWizard := "wizard/install"
	if isUpdate {
		targetWizard = "wizard/upgrade"
	}

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}

		name := strings.ToLower(header.Name)
		// 查找 License
		if name == "license" || name == "license.txt" || name == "license.md" {
			data, err := ioutil.ReadAll(tarReader)
			if err == nil {
				config.License = string(data)
			}
		} else if header.Name == targetWizard {
			// 查找并解析 Wizard
			data, err := ioutil.ReadAll(tarReader)
			if err == nil {
				var steps []models.WizardStep
				if err := json.Unmarshal(data, &steps); err == nil {
					config.Steps = steps
				} else {
					log.Printf("Failed to unmarshal %s from %s: %v", targetWizard, fpkPath, err)
				}
			}
		} else if filepath.Base(name) == "manifest" {
			// 查找并解析 Manifest 获取 install_type
			data, err := ioutil.ReadAll(tarReader)
			if err == nil {
				lines := strings.Split(string(data), "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(strings.ToLower(line), "install_type") {
						parts := strings.SplitN(line, "=", 2)
						if len(parts) == 2 {
							config.InstallType = strings.TrimSpace(parts[1])
						}
					}
				}
			}
		}
	}

	return config, nil
}

// GetAppNameFromFPK 从 FPK 的 manifest 中提取实际的应用名称
func GetAppNameFromFPK(fpkPath string) (string, error) {
	file, err := os.Open(fpkPath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return "", err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		// manifest 文件名可能带路径，也可能不带，通常在根目录
		baseName := filepath.Base(header.Name)
		if strings.ToLower(baseName) == "manifest" {
			data, err := ioutil.ReadAll(tarReader)
			if err != nil {
				return "", err
			}

			content := string(data)
			lines := strings.Split(content, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(strings.ToLower(line), "appname") {
					parts := strings.SplitN(line, "=", 2)
					if len(parts) == 2 {
						return strings.TrimSpace(parts[1]), nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("appname not found in manifest")
}
