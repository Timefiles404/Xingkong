package codex

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/samber/lo"
)

var baseModelList = model.CodexOfficialModelList()

var ModelList = withCompactModelSuffix(baseModelList)

const ChannelName = "codex"

func withCompactModelSuffix(models []string) []string {
	out := make([]string, 0, len(models)*2)
	out = append(out, models...)
	out = append(out, lo.Map(models, func(model string, _ int) string {
		return ratio_setting.WithCompactModelSuffix(model)
	})...)
	return lo.Uniq(out)
}
