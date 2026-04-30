package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

type ProfitSetting struct {
	DownstreamCNYPerUSD              float64 `json:"downstream_cny_per_usd"`
	DefaultUpstreamCNYPerUSD         float64 `json:"default_upstream_cny_per_usd"`
	SubscriptionBreakageEnabled      bool    `json:"subscription_breakage_enabled"`
	ProfitMonitorDetailRetentionDays int     `json:"profit_monitor_detail_retention_days"`
	ProfitMonitorChartDays           int     `json:"profit_monitor_chart_days"`
}

var profitSetting = ProfitSetting{
	DownstreamCNYPerUSD:              1.0 / 7.2,
	DefaultUpstreamCNYPerUSD:         1.0 / 7.2,
	SubscriptionBreakageEnabled:      true,
	ProfitMonitorDetailRetentionDays: 90,
	ProfitMonitorChartDays:           30,
}

func init() {
	config.GlobalConfig.Register("profit_setting", &profitSetting)
}

func GetProfitSetting() *ProfitSetting {
	return &profitSetting
}
