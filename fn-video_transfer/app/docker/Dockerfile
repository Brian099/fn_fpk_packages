FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 安装 ffmpeg
# python:3.12-slim 基于 Debian，可以直接使用 apt 安装 ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖并安装
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 复制应用代码
COPY . /app

# 创建数据目录和配置目录
ENV DATA_DIR=/data
ENV CONFIG_DIR=/config
RUN mkdir -p /data/input /data/output /data/todo /config

EXPOSE 8000

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
