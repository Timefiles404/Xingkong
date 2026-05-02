package controller

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type helperAsset struct {
	FileName string
	URL      string
}

var helperAssets = map[string]helperAsset{
	"windows-amd64": {
		FileName: "xingkong-helper-windows-amd64.exe",
		URL:      "https://github.com/Timefiles404/Newapi-helper/releases/latest/download/xingkong-helper-windows-amd64.exe",
	},
	"linux-amd64": {
		FileName: "xingkong-helper-linux-amd64",
		URL:      "https://github.com/Timefiles404/Newapi-helper/releases/latest/download/xingkong-helper-linux-amd64",
	},
	"linux-arm64": {
		FileName: "xingkong-helper-linux-arm64",
		URL:      "https://github.com/Timefiles404/Newapi-helper/releases/latest/download/xingkong-helper-linux-arm64",
	},
	"darwin-amd64": {
		FileName: "xingkong-helper-darwin-amd64",
		URL:      "https://github.com/Timefiles404/Newapi-helper/releases/latest/download/xingkong-helper-darwin-amd64",
	},
	"darwin-arm64": {
		FileName: "xingkong-helper-darwin-arm64",
		URL:      "https://github.com/Timefiles404/Newapi-helper/releases/latest/download/xingkong-helper-darwin-arm64",
	},
}

func DownloadAgentHelper(c *gin.Context) {
	target := c.Param("target")
	asset, ok := helperAssets[target]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "unsupported_helper_target"})
		return
	}

	client := &http.Client{Timeout: 2 * time.Minute}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, asset.URL, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	req.Header.Set("User-Agent", "xingkong-newapi-helper-downloader")

	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"message": fmt.Sprintf("helper_download_upstream_%d", resp.StatusCode),
		})
		return
	}

	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, asset.FileName))
	c.Header("Cache-Control", "no-store")
	if resp.ContentLength > 0 {
		c.Header("Content-Length", fmt.Sprintf("%d", resp.ContentLength))
	}
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		return
	}
}
