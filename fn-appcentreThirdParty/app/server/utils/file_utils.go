package utils

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"log"
	"os"
	"path/filepath"
)

// EnsureDirs 确保必要的目录存在
func EnsureDirs(appDest, pkgVar string) {
	log.Printf("=== Starting directory creation ===")
	log.Printf("AppDest: %s", appDest)
	log.Printf("PkgVar: %s", pkgVar)

	appStoreDir := filepath.Join(appDest, "AppStore")
	downloadDir := filepath.Join(appDest, "download")
	varDir := pkgVar
	cacheDir := filepath.Join(varDir, "cache")

	log.Printf("AppStoreDir: %s", appStoreDir)
	log.Printf("DownloadDir: %s", downloadDir)
	log.Printf("VarDir: %s", varDir)
	log.Printf("CacheDir: %s", cacheDir)

	dirs := []string{
		appStoreDir,
		downloadDir,
		varDir,
		cacheDir,
	}

	for _, dir := range dirs {
		log.Printf("Creating directory: %s", dir)
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("Failed to create directory %s: %v", dir, err)
		} else {
			log.Printf("Successfully created directory: %s", dir)
			// Check if directory exists
			if _, err := os.Stat(dir); err == nil {
				log.Printf("Directory %s exists and is accessible", dir)
			} else {
				log.Printf("Directory %s still not accessible: %v", dir, err)
			}
		}
	}

	log.Printf("=== Directory creation completed ===")
}

// ExtractTarGz 解压tar.gz文件
func ExtractTarGz(gzipStream io.Reader, targetDir string) error {
	uncompressedStream, err := gzip.NewReader(gzipStream)
	if err != nil {
		return err
	}
	defer uncompressedStream.Close()

	tarReader := tar.NewReader(uncompressedStream)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		targetPath := filepath.Join(targetDir, header.Name)

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(targetPath, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				return err
			}
			outFile, err := os.Create(targetPath)
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
		}
	}

	return nil
}