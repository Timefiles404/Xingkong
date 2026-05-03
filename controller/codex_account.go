package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type codexAccountOAuthCompleteRequest struct {
	Input   string `json:"input"`
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
	Proxy   string `json:"proxy"`
}

type codexAccountImportRequest struct {
	Raw     string `json:"raw"`
	BaseURL string `json:"base_url"`
	Proxy   string `json:"proxy"`
}

type codexAccountUpdateRequest struct {
	Name    *string `json:"name"`
	BaseURL *string `json:"base_url"`
	Proxy   *string `json:"proxy"`
	Status  *int    `json:"status"`
}

func codexAccountOAuthSessionKey(field string) string {
	return fmt.Sprintf("codex_account_oauth_%s", field)
}

func GetCodexAccounts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}
	search := strings.TrimSpace(c.Query("search"))
	tx := model.DB.Model(&model.CodexAccount{})
	if search != "" {
		like := "%" + search + "%"
		tx = tx.Where("name LIKE ? OR email LIKE ? OR account_id LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	var accounts []model.CodexAccount
	if err := tx.Order("id desc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&accounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.CodexAccountPublic, 0, len(accounts))
	for i := range accounts {
		items = append(items, accounts[i].Public())
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page, "page_size": pageSize}})
}

func StartCodexAccountOAuth(c *gin.Context) {
	flow, err := service.CreateCodexOAuthAuthorizationFlow()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	session := sessions.Default(c)
	session.Set(codexAccountOAuthSessionKey("state"), flow.State)
	session.Set(codexAccountOAuthSessionKey("verifier"), flow.Verifier)
	session.Set(codexAccountOAuthSessionKey("created_at"), time.Now().Unix())
	_ = session.Save()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"authorize_url": flow.AuthorizeURL}})
}

func CompleteCodexAccountOAuth(c *gin.Context) {
	req := codexAccountOAuthCompleteRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	code, state, err := parseCodexAuthorizationInput(req.Input)
	if err != nil || strings.TrimSpace(code) == "" || strings.TrimSpace(state) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权回调格式无效"})
		return
	}
	session := sessions.Default(c)
	expectedState, _ := session.Get(codexAccountOAuthSessionKey("state")).(string)
	verifier, _ := session.Get(codexAccountOAuthSessionKey("verifier")).(string)
	if strings.TrimSpace(expectedState) == "" || strings.TrimSpace(verifier) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "OAuth 会话已过期，请重新开始"})
		return
	}
	if state != expectedState {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "state mismatch"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	tokenRes, err := service.ExchangeCodexAuthorizationCodeWithProxy(ctx, code, verifier, req.Proxy)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权码交换失败：" + err.Error()})
		return
	}
	credential, err := service.BuildCodexCredentialFromTokenResult(tokenRes)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	account, err := model.UpsertCodexAccountFromOAuthKey(*credential, req.Name, req.BaseURL, req.Proxy)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	session.Delete(codexAccountOAuthSessionKey("state"))
	session.Delete(codexAccountOAuthSessionKey("verifier"))
	session.Delete(codexAccountOAuthSessionKey("created_at"))
	_ = session.Save()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "saved", "data": account.Public()})
}

func ImportCodexAccounts(c *gin.Context) {
	req := codexAccountImportRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := service.ExtractCodexCredentialObjects(req.Raw)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	imported := 0
	for _, credential := range credentials {
		if _, err := model.UpsertCodexAccountFromOAuthKey(credential, "", req.BaseURL, req.Proxy); err == nil {
			imported++
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"imported": imported, "total": len(credentials)}})
}

func ExportCodexAccounts(c *gin.Context) {
	var accounts []model.CodexAccount
	if err := model.DB.Order("id asc").Find(&accounts).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	out := make([]json.RawMessage, 0, len(accounts))
	for _, account := range accounts {
		raw := strings.TrimSpace(account.Credential)
		if raw != "" {
			out = append(out, json.RawMessage(raw))
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

func UpdateCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	req := codexAccountUpdateRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = strings.TrimSpace(*req.Name)
	}
	if req.BaseURL != nil {
		baseURL := strings.TrimSpace(*req.BaseURL)
		if baseURL == "" {
			baseURL = "https://chatgpt.com"
		}
		updates["base_url"] = baseURL
	}
	if req.Proxy != nil {
		updates["proxy"] = strings.TrimSpace(*req.Proxy)
	}
	if req.Status != nil {
		if *req.Status != model.CodexAccountStatusEnabled && *req.Status != model.CodexAccountStatusDisabled {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid status"})
			return
		}
		updates["status"] = *req.Status
	}
	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true})
		return
	}
	if err := model.DB.Model(&model.CodexAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DB.Delete(&model.CodexAccount{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func RefreshCodexAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	account, err := service.RefreshCodexAccountCredential(ctx, id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": account.Public()})
}

func GetCodexAccountUsage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var account model.CodexAccount
	if err := model.DB.Where("id = ?", id).First(&account).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "account not found"})
			return
		}
		common.ApiError(c, err)
		return
	}
	key, err := model.ParseCodexOAuthCredential(account.Credential)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	client, err := service.GetHttpClientWithProxy(account.Proxy)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if client == nil {
		client = http.DefaultClient
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	baseURL := account.BaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://chatgpt.com"
	}
	status, body, err := service.FetchCodexWhamUsage(ctx, client, baseURL, key.AccessToken, key.AccountID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var data any
	if err := json.Unmarshal(body, &data); err != nil {
		data = string(body)
	}
	c.JSON(http.StatusOK, gin.H{"success": status >= 200 && status < 300, "upstream_status": status, "data": data})
}
