package models

/* https://developer.fnnas.com/docs/cli/appcentercli
appcenter-cli 是飞牛 fnOS 系统预装的应用中心管理工具，它让您能够通过命令行来管理应用的安装、配置和系统设置。无论您是开发者还是系统管理员，这个工具都能帮助您更高效地管理应用。
*/

// App 应用信息结构体
type App struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Version       string   `json:"version"`
	Platform      string   `json:"platform"`
	Categories    []string `json:"categories"`
	Labels        []string `json:"labels"`
	Author        string   `json:"author"`
	Publisher     string   `json:"publisher"`
	Size          string   `json:"size"`
	Icon          string   `json:"icon"`
	Screenshots   []string `json:"screenshots"`
	AppName       string   `json:"appname"`
	DownloadURL   string   `json:"download_url"`
	Changelog     string   `json:"changelog"`
	SourceID      string   `json:"source_id"`
	SourceName    string   `json:"source_name"`
	DownloadCount int      `json:"download_count"`
	Recommended   bool     `json:"recommended"`
	OtherVersions []*App   `json:"other_versions,omitempty"`
}

// FnpackData 应用数据映射
type FnpackData map[string]FnpackApp

// FnpackApp 应用包应用结构体
type FnpackApp struct {
	DisplayName    string              `json:"display_name"`
	Platform       interface{}         `json:"platform"`
	Version        string              `json:"version"`
	Desc           string              `json:"desc"`
	Labels         string              `json:"labels"`
	Author         string              `json:"author"`
	AuthorURL      string              `json:"author_url"`
	BugReportURL   string              `json:"bug_report_url"`
	IsDocker       string              `json:"isdocker"`
	InstallType    string              `json:"install_type"`
	Size           string              `json:"size"`
	DownloadURL    string              `json:"download_url"`
	Changelog      string              `json:"changelog"`
	Distributor    string              `json:"distributor"`
	DistributorURL string              `json:"distributor_url"`
	Recommended    bool                `json:"recommended"`
	ArchDiff       map[string]ArchDiff `json:"arch_diff"`
}

// ArchDiff 架构差异结构体
type ArchDiff struct {
	Version     string `json:"version,omitempty"`
	Desc        string `json:"desc,omitempty"`
	Size        string `json:"size,omitempty"`
	DownloadURL string `json:"download_url,omitempty"`
	Changelog   string `json:"changelog,omitempty"`
}

// WizardItem 向导表单项
type WizardItem struct {
	Type      string      `json:"type"`
	Field     string      `json:"field,omitempty"`
	Label     string      `json:"label,omitempty"`
	InitValue interface{} `json:"initValue,omitempty"`
	HelpText  string      `json:"helpText,omitempty"`
	Options   interface{} `json:"options,omitempty"`
	Rules     interface{} `json:"rules,omitempty"`
}

// WizardStep 向导步骤定义
type WizardStep struct {
	StepTitle string       `json:"stepTitle"`
	Items     []WizardItem `json:"items"`
}

// WizardConfig 向导总配置
type WizardConfig struct {
	License string       `json:"license,omitempty"`
	Steps   []WizardStep `json:"steps"`
}

// StorageVolume 储存卷信息
type StorageVolume struct {
	ID   int    `json:"id"`
	Path string `json:"path"`
}
