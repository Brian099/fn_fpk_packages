FROM jrottenberg/ffmpeg:latest

# 安装 Python 和 pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 设置环境变量，避免 pip 错误
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# 复制依赖并安装
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# 复制应用代码
COPY . /app

# 创建数据目录和配置目录
ENV DATA_DIR=/data
ENV CONFIG_DIR=/config
RUN mkdir -p /data/input /data/output /data/todo /config

EXPOSE 8000

# 重要：覆盖默认的 ENTRYPOINT，确保启动 Python 服务
ENTRYPOINT ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
