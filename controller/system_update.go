package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const (
	xingkongUpdateRepo       = "Timefiles404/Xingkong"
	xingkongUpdateImageRepo  = "ghcr.io/timefiles404/xingkong"
	defaultUpdateComposeFile = "/host-compose/docker-compose.yml"
	defaultUpdateHostCompose = "/opt/1panel/docker/compose/newapi/docker-compose.yml"
	defaultUpdateComposeSvc  = "app"
	updateHTTPTimeout        = 20 * time.Second
	updateCommandTimeout     = 10 * time.Minute
)

var systemUpdateLock sync.Mutex

type githubReleasePayload struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
}

type systemUpdateInfo struct {
	CurrentVersion string                `json:"current_version"`
	LatestVersion  string                `json:"latest_version"`
	HasUpdate      bool                  `json:"has_update"`
	ReleaseInfo    *githubReleasePayload `json:"release_info,omitempty"`
	Repository     string                `json:"repository"`
	Image          string                `json:"image"`
	CanAutoUpdate  bool                  `json:"can_auto_update"`
	AutoUpdateHint string                `json:"auto_update_hint,omitempty"`
}

func CheckSystemUpdate(c *gin.Context) {
	info, err := buildSystemUpdateInfo(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    info,
	})
}

func ApplySystemUpdate(c *gin.Context) {
	if !systemUpdateLock.TryLock() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "已有自动更新任务正在执行，请稍后再试"})
		return
	}

	info, err := buildSystemUpdateInfo(c.Request.Context())
	if err != nil {
		systemUpdateLock.Unlock()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if info.ReleaseInfo == nil || strings.TrimSpace(info.ReleaseInfo.TagName) == "" {
		systemUpdateLock.Unlock()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未找到可用 release"})
		return
	}
	if !info.HasUpdate {
		systemUpdateLock.Unlock()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "当前已是最新版本"})
		return
	}
	if err := checkAutoUpdateReady(); err != nil {
		systemUpdateLock.Unlock()
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error(), "data": info})
		return
	}

	targetImage := buildTargetImage(info.ReleaseInfo.TagName)
	go func() {
		defer systemUpdateLock.Unlock()
		time.Sleep(800 * time.Millisecond)
		if err := performContainerUpdate(targetImage); err != nil {
			common.SysError("system auto update failed: " + err.Error())
			return
		}
		common.SysLog("system auto update applied: " + targetImage)
	}()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "自动更新已启动，容器会在后台拉取镜像并重启服务",
		"data": gin.H{
			"target_image": targetImage,
		},
	})
}

func buildSystemUpdateInfo(ctx context.Context) (*systemUpdateInfo, error) {
	release, err := fetchLatestXingkongRelease(ctx)
	if err != nil {
		return nil, err
	}
	latest := strings.TrimSpace(release.TagName)
	image := buildTargetImage(latest)
	readyErr := checkAutoUpdateReady()
	info := &systemUpdateInfo{
		CurrentVersion: common.Version,
		LatestVersion:  latest,
		HasUpdate:      isNewerVersion(common.Version, latest),
		ReleaseInfo:    release,
		Repository:     xingkongUpdateRepo,
		Image:          image,
		CanAutoUpdate:  readyErr == nil,
	}
	if readyErr != nil {
		info.AutoUpdateHint = readyErr.Error()
	}
	return info, nil
}

func fetchLatestXingkongRelease(ctx context.Context) (*githubReleasePayload, error) {
	reqCtx, cancel := context.WithTimeout(ctx, updateHTTPTimeout)
	defer cancel()
	url := "https://api.github.com/repos/" + xingkongUpdateRepo + "/releases/latest"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "xingkong-newapi-updater")
	if token := strings.TrimSpace(os.Getenv("XINGKONG_UPDATE_GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	} else if token := strings.TrimSpace(os.Getenv("GITHUB_TOKEN")); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接 GitHub Releases 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub Releases 返回 HTTP %d，请确认仓库已发布 release", resp.StatusCode)
	}
	var release githubReleasePayload
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	if strings.TrimSpace(release.TagName) == "" {
		return nil, errors.New("release 缺少 tag_name")
	}
	return &release, nil
}

func checkAutoUpdateReady() error {
	if _, err := exec.LookPath("docker"); err != nil {
		return errors.New("容器内未找到 docker CLI，需使用新版镜像并挂载 Docker socket")
	}
	if _, err := os.Stat("/var/run/docker.sock"); err != nil {
		return errors.New("未挂载 /var/run/docker.sock，无法从容器内重建服务")
	}
	composeFile := updateComposeFile()
	if _, err := os.Stat(composeFile); err != nil {
		return fmt.Errorf("未挂载 compose 文件 %s，无法自动更新", composeFile)
	}
	return nil
}

func performContainerUpdate(targetImage string) error {
	if err := checkAutoUpdateReady(); err != nil {
		return err
	}
	composeFile := updateComposeFile()
	service := updateComposeService()
	project := updateComposeProject()
	if err := updateComposeServiceImage(composeFile, service, targetImage); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), updateCommandTimeout)
	defer cancel()
	if output, err := runUpdateCommand(
		ctx,
		"docker",
		"run",
		"-d",
		"--rm",
		"--name",
		"xingkong-auto-updater-"+strconv.FormatInt(time.Now().Unix(), 10),
		"--entrypoint",
		"sh",
		"-v",
		"/var/run/docker.sock:/var/run/docker.sock",
		"-v",
		updateHostComposeFile()+":/compose/docker-compose.yml",
		"-e",
		"TARGET_IMAGE="+targetImage,
		"-e",
		"SERVICE="+service,
		"-e",
		"COMPOSE_PROJECT="+project,
		updateHelperImage(targetImage),
		"-c",
		`docker pull "$TARGET_IMAGE" && docker compose -p "$COMPOSE_PROJECT" -f /compose/docker-compose.yml up -d --force-recreate "$SERVICE"`,
	); err != nil {
		return fmt.Errorf("failed to start updater container: %w\n%s", err, output)
	}
	return nil
}

func runUpdateCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func updateComposeFile() string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_COMPOSE_FILE")); value != "" {
		return value
	}
	return defaultUpdateComposeFile
}

func updateComposeService() string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_SERVICE")); value != "" {
		return value
	}
	return defaultUpdateComposeSvc
}

func updateComposeProject() string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_COMPOSE_PROJECT")); value != "" {
		return value
	}
	hostComposeFile := strings.TrimSpace(updateHostComposeFile())
	if hostComposeFile == "" {
		return "newapi"
	}
	project := filepath.Base(filepath.Dir(hostComposeFile))
	if project == "." || project == string(filepath.Separator) || project == "" {
		return "newapi"
	}
	return project
}

func updateHostComposeFile() string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_COMPOSE_HOST_FILE")); value != "" {
		return value
	}
	return defaultUpdateHostCompose
}

func updateImageRepo() string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_IMAGE_REPO")); value != "" {
		return value
	}
	return xingkongUpdateImageRepo
}

func updateHelperImage(targetImage string) string {
	if value := strings.TrimSpace(os.Getenv("XINGKONG_AUTO_UPDATE_HELPER_IMAGE")); value != "" {
		return value
	}
	return targetImage
}

func buildTargetImage(tag string) string {
	return updateImageRepo() + ":" + strings.TrimSpace(tag)
}

func updateComposeServiceImage(composeFile, service, image string) error {
	cleanFile, err := filepath.Abs(composeFile)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(cleanFile)
	if err != nil {
		return err
	}
	lines := strings.Split(string(content), "\n")
	inService := false
	serviceHeader := regexp.MustCompile(`^\s{2}` + regexp.QuoteMeta(service) + `:\s*$`)
	sectionHeader := regexp.MustCompile(`^\s{2}[A-Za-z0-9_.-]+:\s*$`)
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if serviceHeader.MatchString(line) {
			inService = true
			continue
		}
		if inService && sectionHeader.MatchString(line) {
			break
		}
		if inService && strings.HasPrefix(trimmed, "image:") {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[i] = indent + "image: " + image
			return os.WriteFile(cleanFile, []byte(strings.Join(lines, "\n")), 0o644)
		}
	}
	return fmt.Errorf("compose service %s image line not found", service)
}

func isNewerVersion(current, latest string) bool {
	current = normalizeVersion(current)
	latest = normalizeVersion(latest)
	if latest == "" {
		return false
	}
	if current == "" || strings.HasPrefix(current, "main-") || strings.Contains(current, "snapshot") {
		return latest != current
	}
	left := versionParts(current)
	right := versionParts(latest)
	for i := 0; i < len(left) || i < len(right); i++ {
		var l, r int
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			r = right[i]
		}
		if r > l {
			return true
		}
		if r < l {
			return false
		}
	}
	return latest != current
}

func normalizeVersion(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "refs/tags/")
	value = strings.TrimPrefix(value, "v")
	return value
}

func versionParts(value string) []int {
	value = normalizeVersion(value)
	chunks := strings.FieldsFunc(value, func(r rune) bool {
		return r == '.' || r == '-' || r == '_'
	})
	parts := make([]int, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk == "" {
			continue
		}
		var digits strings.Builder
		for _, r := range chunk {
			if r < '0' || r > '9' {
				break
			}
			digits.WriteRune(r)
		}
		if digits.Len() == 0 {
			break
		}
		n, _ := strconv.Atoi(digits.String())
		parts = append(parts, n)
	}
	return parts
}
