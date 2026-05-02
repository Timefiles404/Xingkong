package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func Playground(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAI)
}

func PlaygroundResponses(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIResponses)
}

func PlaygroundImageGeneration(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIImage)
}

func PlaygroundImageEdit(c *gin.Context) {
	playgroundRelay(c, types.RelayFormatOpenAIImage)
}

func CreatePlaygroundImageGenerationTask(c *gin.Context) {
	createPlaygroundImageTask(c, "/pg/images/generations")
}

func CreatePlaygroundImageEditTask(c *gin.Context) {
	createPlaygroundImageTask(c, "/pg/images/edits")
}

func GetPlaygroundImageTask(c *gin.Context) {
	userId := c.GetInt("id")
	task, err := model.GetPlaygroundImageTask(c.Param("task_id"), userId)
	if err != nil {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}

	payload := gin.H{
		"id":           task.ID,
		"status":       task.Status,
		"status_code":  task.StatusCode,
		"created_at":   task.CreatedAt,
		"updated_at":   task.UpdatedAt,
		"completed_at": task.CompletedAt,
	}
	if task.Status == model.PlaygroundImageTaskStatusSucceeded && len(task.ResponseBody) > 0 {
		payload["response"] = decodePlaygroundImageTaskBody(task.ResponseBody)
	}
	if task.Status == model.PlaygroundImageTaskStatusFailed {
		payload["error"] = task.ErrorMessage
		if len(task.ResponseBody) > 0 {
			payload["response"] = decodePlaygroundImageTaskBody(task.ResponseBody)
		}
	}
	common.ApiSuccess(c, payload)
}

func decodePlaygroundImageTaskBody(body []byte) any {
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return string(body)
	}
	return decoded
}

func createPlaygroundImageTask(c *gin.Context, relayPath string) {
	userId := c.GetInt("id")
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": err.Error(),
				"type":    "invalid_request",
				"code":    "invalid_request",
			},
		})
		return
	}
	body, err := storage.Bytes()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": err.Error(),
				"type":    "invalid_request",
				"code":    "invalid_request",
			},
		})
		return
	}

	task := &model.PlaygroundImageTask{
		ID:          "img_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		UserId:      userId,
		RelayPath:   relayPath,
		Method:      http.MethodPost,
		ContentType: c.Request.Header.Get("Content-Type"),
		RequestBody: append([]byte(nil), body...),
		Status:      model.PlaygroundImageTaskStatusQueued,
	}
	if err := model.CreatePlaygroundImageTask(task); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	go runPlaygroundImageTask(task.ID)
	common.ApiSuccess(c, gin.H{
		"id":     task.ID,
		"status": task.Status,
	})
}

func runPlaygroundImageTask(taskID string) {
	_ = model.MarkPlaygroundImageTaskRunning(taskID)

	task, err := model.GetPlaygroundImageTaskByID(taskID)
	if err != nil {
		return
	}

	userCache, err := model.GetUserCache(task.UserId)
	if err != nil {
		_ = model.FailPlaygroundImageTask(taskID, http.StatusInternalServerError, err.Error(), nil)
		return
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(task.Method, task.RelayPath, bytes.NewReader(task.RequestBody))
	request.Header.Set("Content-Type", task.ContentType)
	request = request.WithContext(context.Background())
	c.Request = request

	c.Set("id", task.UserId)
	c.Set("use_access_token", false)
	common.SetContextKey(c, constant.ContextKeyUserId, task.UserId)
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
	c.Set(common.RequestIdKey, common.GetTimeString()+common.GetRandomString(8))
	userCache.WriteContext(c)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, userCache.Group)

	defer common.CleanupBodyStorage(c)

	middleware.Distribute()(c)
	if c.IsAborted() || recorder.Code >= http.StatusBadRequest {
		statusCode := recorder.Code
		if statusCode == 0 {
			statusCode = http.StatusInternalServerError
		}
		_ = model.FailPlaygroundImageTask(taskID, statusCode, strings.TrimSpace(recorder.Body.String()), recorder.Body.Bytes())
		return
	}

	switch task.RelayPath {
	case "/pg/images/edits":
		PlaygroundImageEdit(c)
	default:
		PlaygroundImageGeneration(c)
	}

	statusCode := recorder.Code
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	body := append([]byte(nil), recorder.Body.Bytes()...)
	if statusCode >= http.StatusBadRequest {
		_ = model.FailPlaygroundImageTask(taskID, statusCode, strings.TrimSpace(string(body)), body)
		return
	}
	_ = model.CompletePlaygroundImageTask(taskID, statusCode, body)
}

func playgroundRelay(c *gin.Context, relayFormat types.RelayFormat) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = userCache.Group
	}

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", usingGroup),
		Group:  usingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, relayFormat)
}
