package codex

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) ConvertClaudeRequest(*gin.Context, *relaycommon.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/messages endpoint not supported")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/chat/completions endpoint not supported")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/rerank endpoint not supported")
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/embeddings endpoint not supported")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	isCompact := info != nil && info.RelayMode == relayconstant.RelayModeResponsesCompact
	if c != nil {
		c.Set("codex_requested_model", request.Model)
		if sessionKey := codexSessionKeyFromResponsesRequest(request); sessionKey != "" {
			c.Set("codex_session_key", sessionKey)
		}
	}

	if info != nil && info.ChannelSetting.SystemPrompt != "" {
		systemPrompt := info.ChannelSetting.SystemPrompt

		if len(request.Instructions) == 0 {
			if b, err := common.Marshal(systemPrompt); err == nil {
				request.Instructions = b
			} else {
				return nil, err
			}
		} else if info.ChannelSetting.SystemPromptOverride {
			var existing string
			if err := common.Unmarshal(request.Instructions, &existing); err == nil {
				existing = strings.TrimSpace(existing)
				if existing == "" {
					if b, err := common.Marshal(systemPrompt); err == nil {
						request.Instructions = b
					} else {
						return nil, err
					}
				} else {
					if b, err := common.Marshal(systemPrompt + "\n" + existing); err == nil {
						request.Instructions = b
					} else {
						return nil, err
					}
				}
			} else {
				if b, err := common.Marshal(systemPrompt); err == nil {
					request.Instructions = b
				} else {
					return nil, err
				}
			}
		}
	}
	// Codex backend requires the `instructions` field to be present.
	// Keep it consistent with Codex CLI behavior by defaulting to an empty string.
	if len(request.Instructions) == 0 {
		request.Instructions = json.RawMessage(`""`)
	}

	if isCompact {
		return request, nil
	}
	// codex: store must be false
	request.Store = json.RawMessage("false")
	// rm max_output_tokens
	request.MaxOutputTokens = nil
	request.Temperature = nil
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	if _, err := ensureSelectedCodexAccount(c, info); err != nil {
		return nil, err
	}
	resp, err := channel.DoApiRequest(a, c, info, requestBody)
	if err != nil {
		if accountID := c.GetInt("codex_account_id"); accountID > 0 && shouldCooldownCodexAccountForLocalError(err) {
			model.MarkCodexAccountModelRelayResult(accountID, codexRequestedModel(c, info), false, err.Error(), 30, false)
		}
		releaseAndClearSelectedCodexAccount(c)
		return resp, err
	}
	if resp != nil {
		if accountID := c.GetInt("codex_account_id"); accountID > 0 {
			if resp.StatusCode >= 400 {
				if cooldown, accountWide := codexCooldownFromResponse(resp); cooldown > 0 {
					model.MarkCodexAccountModelRelayResult(accountID, codexRequestedModel(c, info), false, resp.Status, cooldown, accountWide)
				}
			}
		}
		if resp.StatusCode != http.StatusOK {
			releaseAndClearSelectedCodexAccount(c)
		}
	}
	return resp, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	defer releaseSelectedCodexAccount(c)
	if info.RelayMode != relayconstant.RelayModeResponses && info.RelayMode != relayconstant.RelayModeResponsesCompact {
		return nil, types.NewError(errors.New("codex channel: endpoint not supported"), types.ErrorCodeInvalidRequest)
	}
	if info.RelayMode == relayconstant.RelayModeResponsesCompact {
		usage, err = openai.OaiResponsesCompactionHandler(c, resp)
		markCodexAccountAfterResponse(c, info, resp, err)
		return usage, err
	}

	if info.IsStream {
		usage, err = openai.OaiResponsesStreamHandler(c, info, resp)
		markCodexAccountAfterResponse(c, info, resp, err)
		return usage, err
	}
	usage, err = openai.OaiResponsesHandler(c, info, resp)
	markCodexAccountAfterResponse(c, info, resp, err)
	return usage, err
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info.RelayMode != relayconstant.RelayModeResponses && info.RelayMode != relayconstant.RelayModeResponsesCompact {
		return "", errors.New("codex channel: only /v1/responses and /v1/responses/compact are supported")
	}
	path := "/backend-api/codex/responses"
	if info.RelayMode == relayconstant.RelayModeResponsesCompact {
		path = "/backend-api/codex/responses/compact"
	}
	return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, path, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)

	key := strings.TrimSpace(info.ApiKey)
	if key == constant.CodexPoolKeyMarker {
		account, err := ensureSelectedCodexAccount(c, info)
		if err != nil {
			return err
		}
		key = strings.TrimSpace(account.Credential)
	}
	if !strings.HasPrefix(key, "{") {
		return errors.New("codex channel: key must be a JSON object")
	}

	oauthKey, err := ParseOAuthKey(key)
	if err != nil {
		return err
	}

	accessToken := strings.TrimSpace(oauthKey.AccessToken)
	accountID := strings.TrimSpace(oauthKey.AccountID)

	if accessToken == "" {
		return errors.New("codex channel: access_token is required")
	}
	if accountID == "" {
		return errors.New("codex channel: account_id is required")
	}

	req.Set("Authorization", "Bearer "+accessToken)
	req.Set("chatgpt-account-id", accountID)

	if req.Get("OpenAI-Beta") == "" {
		req.Set("OpenAI-Beta", "responses=experimental")
	}
	if req.Get("originator") == "" {
		req.Set("originator", "codex_cli_rs")
	}

	// chatgpt.com/backend-api/codex/responses is strict about Content-Type.
	// Clients may omit it or include parameters like `application/json; charset=utf-8`,
	// which can be rejected by the upstream. Force the exact media type.
	req.Set("Content-Type", "application/json")
	if info.IsStream {
		req.Set("Accept", "text/event-stream")
	} else if req.Get("Accept") == "" {
		req.Set("Accept", "application/json")
	}
	return nil
}

func ensureSelectedCodexAccount(c *gin.Context, info *relaycommon.RelayInfo) (*model.CodexAccount, error) {
	if info == nil || strings.TrimSpace(info.ApiKey) != constant.CodexPoolKeyMarker {
		return nil, nil
	}
	if c != nil {
		if selected, ok := c.Get("codex_selected_account"); ok {
			if account, ok := selected.(*model.CodexAccount); ok && account != nil {
				return account, nil
			}
		}
	}
	ownerUserID := 0
	if c != nil {
		ownerUserID = common.GetContextKeyInt(c, constant.ContextKeyCodexSubagentOwnerId)
	}
	account, err := model.SelectCodexAccountForRelayWithOwner(codexSessionKeyFromContext(c), codexRequestedModel(c, info), ownerUserID)
	if err != nil {
		return nil, err
	}
	if baseURL := strings.TrimSpace(account.BaseURL); baseURL != "" {
		info.ChannelBaseUrl = baseURL
	}
	if proxy := strings.TrimSpace(account.Proxy); proxy != "" {
		info.ChannelSetting.Proxy = proxy
	}
	if c != nil {
		c.Set("codex_account_id", account.Id)
		c.Set("codex_selected_account", account)
	}
	return account, nil
}

func releaseSelectedCodexAccount(c *gin.Context) {
	if c == nil {
		return
	}
	if released, ok := c.Get("codex_account_released"); ok {
		if done, _ := released.(bool); done {
			return
		}
	}
	accountID := c.GetInt("codex_account_id")
	if accountID <= 0 {
		return
	}
	model.ReleaseCodexAccountRequest(accountID)
	c.Set("codex_account_released", true)
}

func releaseAndClearSelectedCodexAccount(c *gin.Context) {
	releaseSelectedCodexAccount(c)
	if c == nil || c.Keys == nil {
		return
	}
	delete(c.Keys, "codex_account_id")
	delete(c.Keys, "codex_selected_account")
	delete(c.Keys, "codex_account_released")
}

func markCodexAccountAfterResponse(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response, apiErr *types.NewAPIError) {
	if c == nil {
		return
	}
	accountID := c.GetInt("codex_account_id")
	if accountID <= 0 {
		return
	}
	if apiErr != nil {
		if shouldCooldownCodexAccountForLocalError(apiErr) {
			model.MarkCodexAccountModelRelayResult(accountID, codexRequestedModel(c, info), false, apiErr.Error(), 30, false)
		}
		return
	}
	if resp == nil {
		return
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		model.MarkCodexAccountRelayResult(accountID, true, "", 0)
		model.MarkCodexAccountModelRelayResult(accountID, codexRequestedModel(c, info), true, "", 0, false)
		return
	}
	if cooldown, accountWide := codexCooldownFromResponse(resp); cooldown > 0 {
		model.MarkCodexAccountModelRelayResult(accountID, codexRequestedModel(c, info), false, resp.Status, cooldown, accountWide)
	}
}

func codexRequestedModel(c *gin.Context, info *relaycommon.RelayInfo) string {
	if c != nil {
		if modelName := strings.TrimSpace(c.GetString("codex_requested_model")); modelName != "" {
			return modelName
		}
	}
	if info != nil {
		return strings.TrimSpace(info.OriginModelName)
	}
	return ""
}

func codexSessionKeyFromContext(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	if sessionKey := strings.TrimSpace(c.GetString("codex_session_key")); sessionKey != "" {
		return "prompt_cache:" + sessionKey
	}
	for _, name := range []string{"X-Session-ID", "Session_id", "X-Client-Request-Id"} {
		if value := strings.TrimSpace(c.Request.Header.Get(name)); value != "" {
			return strings.ToLower(name) + ":" + value
		}
	}
	return ""
}

func codexSessionKeyFromResponsesRequest(request dto.OpenAIResponsesRequest) string {
	if key := rawJSONString(request.PromptCacheKey); key != "" {
		return key
	}
	if request.PreviousResponseID != "" {
		return "previous_response:" + request.PreviousResponseID
	}
	return rawJSONString(request.User)
}

func rawJSONString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}
	return strings.Trim(strings.TrimSpace(string(raw)), `"`)
}

func codexCooldownSecondsFromResponse(resp *http.Response) int64 {
	seconds, _ := codexCooldownFromResponse(resp)
	return seconds
}

func codexCooldownFromResponse(resp *http.Response) (int64, bool) {
	if resp == nil {
		return 0, false
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return 3600, true
	case http.StatusForbidden:
		return 3600, false
	case http.StatusTooManyRequests:
		if seconds := parseRetryAfterSeconds(resp.Header.Get("Retry-After")); seconds > 0 {
			return seconds, false
		}
		return 300, false
	default:
		if resp.StatusCode >= 500 {
			return 60, false
		}
		return 0, false
	}
}

func parseRetryAfterSeconds(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if n < 0 {
			return 0
		}
		if n > 86400 {
			return 86400
		}
		return n
	}
	if t, err := http.ParseTime(raw); err == nil {
		seconds := int64(time.Until(t).Seconds())
		if seconds < 0 {
			return 0
		}
		if seconds > 86400 {
			return 86400
		}
		return seconds
	}
	return 0
}

func shouldCooldownCodexAccountForLocalError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return !strings.Contains(msg, "context canceled") &&
		!strings.Contains(msg, "client gone") &&
		!strings.Contains(msg, "broken pipe") &&
		!strings.Contains(msg, "request canceled")
}
