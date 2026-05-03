package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func BuildCodexCredentialFromTokenResult(tokenRes *CodexOAuthTokenResult) (*model.CodexOAuthCredential, error) {
	if tokenRes == nil {
		return nil, errors.New("empty token result")
	}
	accountID, ok := ExtractCodexAccountIDFromJWT(tokenRes.IDToken)
	if !ok {
		accountID, ok = ExtractCodexAccountIDFromJWT(tokenRes.AccessToken)
	}
	if !ok {
		return nil, errors.New("failed to extract account_id from token")
	}
	email, _ := ExtractEmailFromJWT(tokenRes.IDToken)
	if email == "" {
		email, _ = ExtractEmailFromJWT(tokenRes.AccessToken)
	}
	return &model.CodexOAuthCredential{
		IDToken:      tokenRes.IDToken,
		AccessToken:  tokenRes.AccessToken,
		RefreshToken: tokenRes.RefreshToken,
		AccountID:    accountID,
		LastRefresh:  time.Now().Format(time.RFC3339),
		Expired:      tokenRes.ExpiresAt.Format(time.RFC3339),
		Email:        email,
		Type:         "codex",
	}, nil
}

func RefreshCodexAccountCredential(ctx context.Context, accountID int) (*model.CodexAccount, error) {
	var account model.CodexAccount
	if err := model.DB.Where("id = ?", accountID).First(&account).Error; err != nil {
		return nil, err
	}
	key, err := model.ParseCodexOAuthCredential(account.Credential)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(key.RefreshToken) == "" {
		return nil, errors.New("refresh_token is required")
	}
	res, err := RefreshCodexOAuthTokenWithProxy(ctx, key.RefreshToken, account.Proxy)
	if err != nil {
		_ = model.DB.Model(&model.CodexAccount{}).Where("id = ?", account.Id).Updates(map[string]any{
			"last_error": err.Error(),
			"updated_at": common.GetTimestamp(),
		}).Error
		return nil, err
	}
	key.AccessToken = res.AccessToken
	key.RefreshToken = res.RefreshToken
	if strings.TrimSpace(res.IDToken) != "" {
		key.IDToken = res.IDToken
	}
	key.LastRefresh = time.Now().Format(time.RFC3339)
	key.Expired = res.ExpiresAt.Format(time.RFC3339)
	if strings.TrimSpace(key.Type) == "" {
		key.Type = "codex"
	}
	if strings.TrimSpace(key.AccountID) == "" {
		if extracted, ok := ExtractCodexAccountIDFromJWT(res.IDToken); ok {
			key.AccountID = extracted
		} else if extracted, ok := ExtractCodexAccountIDFromJWT(res.AccessToken); ok {
			key.AccountID = extracted
		}
	}
	if strings.TrimSpace(key.Email) == "" {
		if email, ok := ExtractEmailFromJWT(res.IDToken); ok {
			key.Email = email
		} else if email, ok := ExtractEmailFromJWT(res.AccessToken); ok {
			key.Email = email
		}
	}
	updated, err := model.UpsertCodexAccountFromOAuthKey(*key, account.Name, account.BaseURL, account.Proxy)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func ExtractCodexCredentialObjects(raw string) ([]model.CodexOAuthCredential, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("empty import content")
	}
	var root any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return nil, err
	}
	out := make([]model.CodexOAuthCredential, 0)
	collectCodexCredentials(root, &out)
	if len(out) == 0 {
		return nil, fmt.Errorf("no Codex credentials found")
	}
	return out, nil
}

func collectCodexCredentials(v any, out *[]model.CodexOAuthCredential) {
	switch val := v.(type) {
	case []any:
		for _, item := range val {
			collectCodexCredentials(item, out)
		}
	case map[string]any:
		if cred, ok := mapToCodexCredential(val); ok {
			*out = append(*out, cred)
		}
		for _, item := range val {
			collectCodexCredentials(item, out)
		}
	}
}

func mapToCodexCredential(m map[string]any) (model.CodexOAuthCredential, bool) {
	cred := model.CodexOAuthCredential{
		IDToken:      stringFromAny(m["id_token"]),
		AccessToken:  stringFromAny(m["access_token"]),
		RefreshToken: stringFromAny(m["refresh_token"]),
		AccountID:    stringFromAny(m["account_id"]),
		LastRefresh:  stringFromAny(m["last_refresh"]),
		Email:        stringFromAny(m["email"]),
		Type:         stringFromAny(m["type"]),
		Expired:      stringFromAny(m["expired"]),
	}
	if cred.AccessToken == "" || cred.RefreshToken == "" {
		return model.CodexOAuthCredential{}, false
	}
	if cred.Type != "" && !strings.EqualFold(cred.Type, "codex") {
		return model.CodexOAuthCredential{}, false
	}
	if cred.AccountID == "" {
		if accountID, ok := ExtractCodexAccountIDFromJWT(cred.IDToken); ok {
			cred.AccountID = accountID
		} else if accountID, ok := ExtractCodexAccountIDFromJWT(cred.AccessToken); ok {
			cred.AccountID = accountID
		}
	}
	if cred.Email == "" {
		if email, ok := ExtractEmailFromJWT(cred.IDToken); ok {
			cred.Email = email
		} else if email, ok := ExtractEmailFromJWT(cred.AccessToken); ok {
			cred.Email = email
		}
	}
	if cred.AccountID == "" {
		return model.CodexOAuthCredential{}, false
	}
	if cred.Type == "" {
		cred.Type = "codex"
	}
	return cred, true
}

func stringFromAny(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", x))
	}
}
