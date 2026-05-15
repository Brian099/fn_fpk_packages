#!/bin/bash

# --- 配置信息 ---
API_TOKEN="sk_18afabfb76feb5c6"
UPLOAD_URL="https://images.laokhome.cn/api/v1/private/upload"
TARGET_CATEGORY_ID=2

echo "=== 开始必应壁纸自动采集 (Shell 版) ==="

# 1. 获取必应壁纸数据 (JSON 格式)
BING_JSON=$(curl -s "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN")

if [ -z "$BING_JSON" ]; then
    echo "❌ 无法获取必应壁纸数据"
    exit 1
fi

# 2. 使用 jq 解析字段
# -r 参数表示输出原始字符串（去掉引号）
IMAGE_URL_SUFFIX=$(echo "$BING_JSON" | jq -r '.images[0].url')
TITLE=$(echo "$BING_JSON" | jq -r '.images[0].title // "必应每日壁纸"')
COPYRIGHT=$(echo "$BING_JSON" | jq -r '.images[0].copyright // "No copyright info"')
FULL_URL="https://www.bing.com${IMAGE_URL_SUFFIX}"

echo "获取到图片: $TITLE"
echo "正在尝试上传..."

# 3. 构造上传的 JSON 载荷
# 使用 jq 构造 JSON 可以完美处理字符串中的特殊字符和引号
PAYLOAD=$(jq -n \
    --arg mode "remote" \
    --arg url "$FULL_URL" \
    --argjson cat_id "$TARGET_CATEGORY_ID" \
    --arg title "$TITLE" \
    --arg desc "$COPYRIGHT" \
    --arg tag "必应" \
    '{mode: $mode, url: $url, category_id: $cat_id, title: $title, description: $desc, tags: [$tag]}')

# 4. 执行上传请求
RESPONSE=$(curl -s -X POST "$UPLOAD_URL" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

# 5. 检查上传结果
CODE=$(echo "$RESPONSE" | jq -r '.code')
MSG=$(echo "$RESPONSE" | jq -r '.msg')

if [ "$CODE" == "200" ]; then
    IMAGE_ID=$(echo "$RESPONSE" | jq -r '.data.id')
    echo "✅ 上传成功！图片 ID: $IMAGE_ID"
else
    echo "❌ 上传失败: $MSG"
    echo "详细响应: $RESPONSE"
    exit 1
fi
