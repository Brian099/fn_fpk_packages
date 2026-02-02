FROM public.ecr.aws/docker/library/python:3.10-slim

# 设置时区和安装 ffmpeg
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装 ffmpeg 和其他必要工具
# --no-install-recommends 减少镜像大小
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

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

# 启动命令
ENTRYPOINT ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
