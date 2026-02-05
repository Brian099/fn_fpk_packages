import os
import uuid
import hashlib
import shutil
import subprocess
import re
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException, Depends, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from jose import JWTError, jwt
import bcrypt

# 配置路径
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", BASE_DIR / "config"))
INPUT_DIR = DATA_DIR / "input"
OUTPUT_DIR = DATA_DIR / "output"
STATIC_DIR = BASE_DIR / "static"
PREVIEW_DIR = DATA_DIR / "previews"

# 允许的视频扩展名
ALLOWED_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".mpeg", ".mpg", ".flv", ".ts", ".m4v"}

# 确保目录存在
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
INPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

# 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 内存中存储任务状态（生产环境建议使用数据库）
class JobStatus(BaseModel):
    id: str
    inputs: List[str]
    outputs: List[str]
    params: Dict[str, Any]
    status: str  # running, completed, failed
    command: Optional[str] = None
    error: Optional[str] = None
    input_size: Optional[int] = None
    output_size: Optional[int] = None
    compression_ratio: Optional[float] = None
    duration: Optional[float] = None
    progress: float = 0.0
    created_at: float = Field(default_factory=lambda: datetime.now().timestamp())
    completed_at: Optional[float] = None

JOBS: Dict[str, JobStatus] = {}
JOB_PROCESSES: Dict[str, subprocess.Popen] = {}

# 并发控制
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", 2))
# 使用足够大的线程池来容纳可能的并发任务，实际调度由逻辑控制
executor = ThreadPoolExecutor(max_workers=20)

def try_start_jobs():
    """尝试启动更多任务，直到达到最大并发数"""
    running_count = sum(1 for j in JOBS.values() if j.status == "running")
    available_slots = MAX_CONCURRENT_JOBS - running_count
    
    if available_slots > 0:
        # 查找所有 pending 的任务，按创建时间排序
        pending_jobs = sorted(
            [j for j in JOBS.values() if j.status == "pending"], 
            key=lambda x: x.created_at
        )
        
        # 启动任务
        for job in pending_jobs[:available_slots]:
            # 双重检查：防止在列出任务后任务被取消
            if job.status != "pending":
                continue
            job.status = "running"
            executor.submit(run_transcode_job_wrapper, job.id)

def run_transcode_job_wrapper(job_id: str):
    """包装转码任务，确保完成后触发调度"""
    try:
        run_transcode_job(job_id)
    finally:
        # 任务结束（无论成功失败），尝试启动新任务
        try_start_jobs()

class TranscodeParams(BaseModel):
    vcodec: Optional[str] = "libx264"
    acodec: Optional[str] = "aac"
    bitrate: Optional[str] = None
    crf: Optional[int] = None
    preset: Optional[str] = None
    resolution: Optional[str] = None
    format: Optional[str] = "mp4"
    hw_accel: Optional[str] = None
    threads: Optional[int] = 0
    scodec: Optional[str] = "copy" # 字幕编码，默认复制，预览时可设为 None 禁用
    deinterlace: bool = False
    rotation: Optional[str] = None
    extra_args: Optional[List[str]] = None

class TranscodeRequest(BaseModel):
    inputs: List[str]
    params: TranscodeParams
    output_dir: Optional[str] = None

# --- Auth Configuration ---
SECRET_KEY = os.environ.get("SECRET_KEY", "ffmpeg-web-ui-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

USERS_FILE = CONFIG_DIR / "users.json"

class User(BaseModel):
    username: str
    disabled: Optional[bool] = None

class UserInDB(User):
    hashed_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class PasswordChange(BaseModel):
    old_password: str
    new_password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str

def hash_password_pre(password: str) -> str:
    # bcrypt max length is 72 bytes.
    # To support longer passwords, we hash them with sha256 first.
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def get_password_hash(password):
    # Ensure we stay within bcrypt limits by using the pre-hashed hex string (64 chars)
    pwd_bytes = hash_password_pre(password).encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password, hashed_password):
    pwd_bytes = hash_password_pre(plain_password).encode('utf-8')
    # handle cases where hashed_password might be string or bytes
    hash_bytes = hashed_password.encode('utf-8') if isinstance(hashed_password, str) else hashed_password
    try:
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except ValueError:
        return False

def load_users():
    if not USERS_FILE.exists():
        return {}
    try:
        with open(USERS_FILE, "r") as f:
            content = f.read()
            if not content.strip():
                return {}
            return json.loads(content)
    except:
        return {}

def save_users(users_db):
    with open(USERS_FILE, "w") as f:
        json.dump(users_db, f, indent=2)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    users_db = load_users()
    user_data = users_db.get(username)
    if user_data is None:
        raise credentials_exception
    user = UserInDB(**user_data)
    if user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user

# --- End Auth Configuration ---

def get_video_duration(input_path: Path) -> float:
    """使用 ffprobe 获取视频时长(秒)"""
    try:
        cmd = [
            "ffprobe", 
            "-v", "error", 
            "-show_entries", "format=duration", 
            "-of", "default=noprint_wrappers=1:nokey=1", 
            str(input_path)
        ]
        ret = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if ret.returncode == 0:
            return float(ret.stdout.strip())
    except:
        pass
    return 0.0

# 核心转码逻辑
def build_ffmpeg_cmd(input_path: Path, output_path: Path, params: TranscodeParams, input_options: List[str] = None) -> List[str]:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "info"]

    # 硬件加速配置 (必须在 -i 之前)
    use_cuda = False
    use_qsv = False
    use_vaapi = False
    
    if params.hw_accel and params.hw_accel.startswith("cuda"):
        use_cuda = True
        cmd.extend(["-hwaccel", "cuda"])
        cmd.extend(["-hwaccel_output_format", "cuda"])
        
        # 指定 GPU 设备
        if ":" in params.hw_accel:
            device_idx = params.hw_accel.split(":")[1]
            cmd.extend(["-hwaccel_device", device_idx])
            
    elif params.hw_accel == "qsv":
        use_qsv = True
        cmd.extend(["-hwaccel", "qsv"])
        cmd.extend(["-hwaccel_output_format", "qsv"])
        
    elif params.hw_accel == "vaapi":
        use_vaapi = True
        # AMD/Intel VAAPI 通用配置
        cmd.extend(["-hwaccel", "vaapi"])
        cmd.extend(["-hwaccel_device", "/dev/dri/renderD128"]) # 默认渲染设备
        cmd.extend(["-hwaccel_output_format", "vaapi"])

    if input_options:
        cmd.extend(input_options)

    cmd.extend(["-i", str(input_path)])
    
    # 关键：映射所有流 (视频/音频/字幕)
    cmd.extend(["-map", "0"])

    # 视频编码器自动切换
    vcodec = params.vcodec
    if use_cuda:
        if vcodec == "libx264":
            vcodec = "h264_nvenc"
        elif vcodec == "libx265":
            vcodec = "hevc_nvenc"
            
    if vcodec:
        cmd.extend(["-c:v", vcodec])
        
    if params.acodec:
        cmd.extend(["-c:a", params.acodec])
    
    # 字幕处理
    if params.scodec and params.scodec.lower() != "none":
        cmd.extend(["-c:s", params.scodec])
    else:
        # 显式禁用字幕
        cmd.extend(["-sn"])

    if params.bitrate:
        cmd.extend(["-b:v", params.bitrate])
        
    # CRF (注意: nvenc 也支持 -cq/-rc 等，但简单的 -crf 可能被忽略或需要改用 -cq，这里暂且保留，ffmpeg 通常会做适配或忽略)
    # 对于 nvenc，通常用 -rc constqp -qp N 或 -rc vbr -cq N
    # 简单起见，如果使用 nvenc 且指定了 crf，我们尝试保留原样，或者警告。
    # 实际上 ffmpeg 的 h264_nvenc 不支持 -crf，它使用 -cq (VBR) 或 -qp (CQP)
    # 为了简化，如果检测到 nvenc 且有 crf，我们尝试转换为 -cq
    if params.crf is not None:
        if use_cuda and "nvenc" in vcodec:
            cmd.extend(["-rc", "vbr", "-cq", str(params.crf), "-qmin", str(params.crf), "-qmax", str(params.crf)])
        elif use_qsv and "qsv" in vcodec:
             # QSV 通常使用 -global_quality (ICQ 模式)
             cmd.extend(["-global_quality", str(params.crf)])
        else:
            cmd.extend(["-crf", str(params.crf)])
            
    if params.preset:
        cmd.extend(["-preset", params.preset])
        
    # 视频过滤器链 (Scale, Deinterlace, Rotate)
    filters = []
    
    # 决定是否使用硬件滤镜
    # 如果有旋转需求，暂时禁用硬件滤镜以简化兼容性处理 (依靠 FFmpeg 自动协商 hwdownload)
    use_hw_filters = use_cuda and (not params.rotation)

    # 反交错 (建议在缩放前处理)
    if params.deinterlace:
        if use_hw_filters:
            # CUDA 硬件反交错 (需要 ffmpeg 支持 yadif_cuda)
            # 0:-1:0 -> mode:parity:deint (default)
            filters.append("yadif_cuda=0:-1:0")
        else:
            # CPU 软件反交错
            filters.append("yadif")

    if params.resolution:
        if use_hw_filters:
            # 使用 scale_cuda 过滤器
            filters.append(f"scale_cuda={params.resolution}")
        else:
            filters.append(f"scale={params.resolution}")
            
    if params.rotation:
        rot_map = {
            "90": "transpose=1",
            "180": "transpose=1,transpose=1",
            "270": "transpose=2"
        }
        if params.rotation in rot_map:
            filters.append(rot_map[params.rotation])
    
    if filters:
        cmd.extend(["-vf", ",".join(filters)])
            
    if params.threads is not None and params.threads > 0:
        cmd.extend(["-threads", str(params.threads)])
    
    if params.extra_args:
        cmd.extend(params.extra_args)
        
    cmd.append(str(output_path))
    return cmd

def run_transcode_job(job_id: str):
    job = JOBS[job_id]
    try:
        # 简单实现：顺序处理所有输入文件
        for idx, input_file in enumerate(job.inputs):
            # 检查任务是否已被取消
            if job.status == "cancelled":
                break

            inp = Path(input_file)
            if not inp.exists():
                raise FileNotFoundError(f"输入文件不存在: {inp}")
            
            # 确定输出路径
            suffix = f".{job.params.get('format', 'mp4')}"
            out_name = inp.stem + suffix
            # 如果指定了输出目录则使用，否则默认
            if job.outputs and len(job.outputs) > idx:
                 # 此时 outputs 已经在创建任务时预填充了，这里确认一下
                 pass
            
            # 这里简单起见，重新计算输出路径以确保正确
            out_dir = OUTPUT_DIR
            if job.outputs and len(job.outputs) > 0:
                 out_dir = Path(job.outputs[0]).parent
            
            output_path = out_dir / out_name
            
            # 构建参数对象
            params_obj = TranscodeParams(**job.params)
            cmd = build_ffmpeg_cmd(inp, output_path, params_obj)
            
            # 更新任务信息中的命令（仅记录最后一条）
            job.command = " ".join(cmd)
            
            # 执行命令
            # 使用 -progress pipe:1 将进度信息输出到 stdout，方便解析
            # 或者直接读取 stderr (ffmpeg 默认输出到 stderr)
            # 为了稳妥，我们读取 stderr，并使用 Universal Newlines
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
            # 存储进程对象
            JOB_PROCESSES[job_id] = process
            
            # 实时读取输出以更新进度
            # FFmpeg 输出到 stderr
            while True:
                line = process.stderr.readline()
                if not line and process.poll() is not None:
                    break
                
                if line:
                    # 尝试解析时间 time=00:00:00.00
                    # 示例: frame=  200 fps= 45 q=28.0 size=    1024kB time=00:00:10.50 bitrate= 799.0kbits/s speed=2.3x
                    if "time=" in line:
                        try:
                            match = re.search(r'time=(\d{2}):(\d{2}):(\d{2}\.\d+)', line)
                            if match:
                                h, m, s = map(float, match.groups())
                                current_seconds = h * 3600 + m * 60 + s
                                if job.duration and job.duration > 0:
                                    progress = min(100.0, (current_seconds / job.duration) * 100)
                                    job.progress = progress
                        except:
                            pass
            
            # 等待结束
            stdout, stderr = process.communicate() # 获取剩余输出
            
            # 清理进程引用
            if job_id in JOB_PROCESSES:
                del JOB_PROCESSES[job_id]
            
            # 再次检查状态
            if job.status == "cancelled":
                break

            if process.returncode != 0:
                # 如果是正常结束但有 stderr 输出是正常的，我们需要区分是否真的出错
                # 通常 returncode != 0 才是真的错
                raise RuntimeError(f"FFmpeg Error: Return Code {process.returncode}")
        
        # 只有未取消且无错误才标记为完成
        if job.status != "cancelled":
            job.status = "completed"
            job.progress = 100.0 # 确保显示完成
            job.completed_at = datetime.now().timestamp()
            
            # 计算输出大小和压缩率
            try:
                # 假设只有一个输出文件（因为我们拆分了任务）
                if job.outputs:
                    out_p = Path(job.outputs[0])
                    if out_p.exists():
                        job.output_size = out_p.stat().st_size
                        
                        if job.input_size and job.input_size > 0:
                            # 压缩率 = 输出 / 输入 (例如 0.5 表示 50%)
                            # 或者用户想要的可能是压缩比例 (Saved space?)
                            # 通常压缩比例指的是 Output Size / Input Size * 100%
                            # 或者 Compression Ratio 2:1 etc.
                            # 这里存储小数比率，前端去格式化
                            job.compression_ratio = job.output_size / job.input_size
            except Exception as e:
                print(f"Error calculating stats: {e}")
                
    except Exception as e:
        # 如果是取消导致的错误，不标记为失败
        if job.status != "cancelled":
            job.status = "failed"
            job.error = str(e)

# --- Auth Endpoints ---

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    users_db = load_users()
    user_data = users_db.get(form_data.username)
    if not user_data or not verify_password(form_data.password, user_data["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = UserInDB(**user_data)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/auth/setup-required")
def is_setup_required():
    users = load_users()
    return {"setup_required": len(users) == 0}

@app.post("/auth/setup")
def setup_first_user(new_user: CreateUserRequest):
    try:
        users_db = load_users()
        if len(users_db) > 0:
            raise HTTPException(status_code=403, detail="Setup already completed")
            
        hashed = get_password_hash(new_user.password)
        
        users_db[new_user.username] = {
            "username": new_user.username,
            "hashed_password": hashed,
            "disabled": False
        }
        save_users(users_db)
        
        # Auto login
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": new_user.username}, expires_delta=access_token_expires
        )
        return {"access_token": access_token, "token_type": "bearer"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        # 如果是 HTTPException 直接抛出
        if isinstance(e, HTTPException):
            raise e
        # 其他错误返回 500 并带上详情以便调试
        raise HTTPException(status_code=500, detail=f"Setup failed: {str(e)}")

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/users/password")
async def change_password(
    password_data: PasswordChange, 
    current_user: User = Depends(get_current_user)
):
    users_db = load_users()
    if not verify_password(password_data.old_password, users_db[current_user.username]["hashed_password"]):
        raise HTTPException(status_code=400, detail="Old password incorrect")
    
    users_db[current_user.username]["hashed_password"] = get_password_hash(password_data.new_password)
    save_users(users_db)
    return {"message": "Password updated successfully"}

@app.post("/users")
async def create_new_user(
    new_user: CreateUserRequest,
    current_user: User = Depends(get_current_user)
):
    if current_user.username != "admin":
        raise HTTPException(status_code=403, detail="Only admin can create users")
        
    users_db = load_users()
    if new_user.username in users_db:
        raise HTTPException(status_code=400, detail="Username already registered")
        
    users_db[new_user.username] = {
        "username": new_user.username,
        "hashed_password": get_password_hash(new_user.password),
        "disabled": False
    }
    save_users(users_db)
    return {"username": new_user.username}

# --- API Interfaces ---

@app.get("/thumbnail")
async def get_thumbnail(path: str):
    """Generate or retrieve a thumbnail for a video file."""
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
        
    # Thumbnails cache directory
    thumb_dir = DATA_DIR / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    
    # Hash path to get unique filename
    path_hash = hashlib.md5(str(p).encode('utf-8')).hexdigest()
    thumb_path = thumb_dir / f"{path_hash}.jpg"
    
    if not thumb_path.exists():
        # Generate thumbnail using ffmpeg
        try:
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", "00:00:05", # Try to take frame at 5s
                "-i", str(p),
                "-vframes", "1",
                "-q:v", "2",
                "-vf", "scale=320:-1", # Resize width to 320px, keep aspect ratio
                str(thumb_path)
            ]
            # If video is shorter than 5s, try 0s
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            
            if not thumb_path.exists():
                 # Retry at 0s if 5s failed (maybe video is short)
                cmd[6] = "00:00:00"
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                
        except Exception as e:
            print(f"Thumbnail generation failed: {e}")
            
    if thumb_path.exists():
        return FileResponse(thumb_path)
    
    # Return a default placeholder or 404
    raise HTTPException(status_code=404, detail="Thumbnail could not be generated")

class FileInfo(BaseModel):
    path: str
    exists: bool
    size: Optional[int] = None
    size_fmt: Optional[str] = None
    duration: Optional[float] = None
    duration_fmt: Optional[str] = None
    
class BatchFileRequest(BaseModel):
    files: List[str]

@app.post("/files/batch-info", response_model=List[FileInfo])
async def get_batch_file_info(req: BatchFileRequest, current_user: User = Depends(get_current_user)):
    results = []
    for fpath in req.files:
        p = Path(fpath)
        info = FileInfo(path=fpath, exists=p.exists())
        if p.exists() and p.is_file():
            try:
                st = p.stat()
                info.size = st.st_size
                # Format size
                for unit in ['B', 'KB', 'MB', 'GB']:
                    if info.size < 1024.0:
                        info.size_fmt = f"{info.size:.2f} {unit}"
                        break
                    info.size /= 1024.0
                else:
                    info.size_fmt = f"{info.size:.2f} TB"
                
                # Restore raw size for sorting if needed
                info.size = st.st_size
                
                info.duration = get_video_duration(p)
                m, s = divmod(int(info.duration), 60)
                h, m = divmod(m, 60)
                info.duration_fmt = f"{h:02d}:{m:02d}:{s:02d}"
            except:
                pass
        results.append(info)
    return results

@app.get("/")
def read_root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/jobs")
def get_jobs(current_user: User = Depends(get_current_user)):
    # 按时间倒序返回
    return list(reversed(list(JOBS.values())))

@app.get("/hardware-info")
def get_hardware_info(current_user: User = Depends(get_current_user)):
    """检测可用硬件加速"""
    info = {
        "cpu": True,
        "cpu_count": os.cpu_count() or 4,
        "cuda": False,
        "cuda_devices": [],
        "qsv": False,
        "vaapi": False
    }
    
    # 1. 检测 NVIDIA CUDA
    # 简单检查 nvidia-smi 是否可用且能返回成功
    if shutil.which("nvidia-smi"):
        try:
            # 运行 nvidia-smi -L 快速检查
            # Output example: GPU 0: NVIDIA GeForce RTX 3060 (UUID: GPU-...)
            ret = subprocess.run(["nvidia-smi", "-L"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            if ret.returncode == 0:
                info["cuda"] = True
                # 解析具体型号
                for line in ret.stdout.strip().split('\n'):
                    if not line.strip(): continue
                    # 匹配 GPU 0: Name (UUID...
                    match = re.search(r'GPU\s+(\d+):\s+(.+?)\s+\(UUID', line)
                    if match:
                        info["cuda_devices"].append({
                            "index": int(match.group(1)),
                            "name": match.group(2)
                        })
                    else:
                        # Fallback parsing if regex fails
                        parts = line.split(':')
                        if len(parts) >= 2:
                            info["cuda_devices"].append({
                                "index": len(info["cuda_devices"]), 
                                "name": parts[1].split('(')[0].strip()
                            })
        except:
            pass
            
    # 2. 检测 Intel/AMD 核显 (VAAPI/QSV)
    # 检查 /dev/dri 目录是否存在
    if Path("/dev/dri").exists():
        # 通常 /dev/dri/renderD128 存在即意味着支持 VAAPI/QSV
        if list(Path("/dev/dri").glob("renderD*")):
            info["qsv"] = True
            info["vaapi"] = True
            
    return info

@app.get("/settings/concurrency")
def get_concurrency(current_user: User = Depends(get_current_user)):
    return {"max_concurrent_jobs": MAX_CONCURRENT_JOBS}

@app.post("/settings/concurrency")
def set_concurrency(count: int = Form(...), current_user: User = Depends(get_current_user)):
    global MAX_CONCURRENT_JOBS
    if count < 1:
        raise HTTPException(status_code=400, detail="并发数必须大于 0")
    MAX_CONCURRENT_JOBS = count
    # 立即尝试启动更多任务
    try_start_jobs()
    return {"max_concurrent_jobs": MAX_CONCURRENT_JOBS}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    
    file_path = INPUT_DIR / file.filename
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"filename": file.filename, "path": str(file_path)}

@app.post("/scan-directory")
def scan_directory(path: str = Form(...), current_user: User = Depends(get_current_user)):
    base_path = Path(path)
    if not base_path.exists():
        raise HTTPException(status_code=400, detail="路径不存在")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail="该路径不是目录")
        
    found_files = []
    # 递归扫描
    for p in base_path.rglob("*"):
        if p.is_file() and p.suffix.lower() in ALLOWED_EXTS:
            found_files.append(str(p))
            
    if not found_files:
        raise HTTPException(status_code=400, detail="未找到视频文件")
        
    return {"count": len(found_files), "files": found_files}

@app.post("/transcode")
def create_transcode_job(req: TranscodeRequest, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    # 验证输入
    if not req.inputs:
        raise HTTPException(status_code=400, detail="没有输入文件")
        
    created_jobs = []
    
    # 预计算输出路径用于展示
    out_dir = Path(req.output_dir) if req.output_dir else OUTPUT_DIR
    suffix = f".{req.params.format}"
    
    # 将每个输入文件拆分为独立任务
    for inp in req.inputs:
        job_id = uuid.uuid4().hex
        p = Path(inp)
        
        # 清理该文件的旧预览
        try:
            path_hash = get_path_hash(p)
            for preview_file in PREVIEW_DIR.glob(f"preview_{path_hash}_*.mp4"):
                try:
                    preview_file.unlink()
                except:
                    pass
        except:
            pass
        
        # 获取源文件大小
        input_size = 0
        duration = 0.0
        try:
            if p.exists():
                input_size = p.stat().st_size
                duration = get_video_duration(p)
        except:
            pass
        
        # 单个任务的输出列表
        single_output = [str(out_dir / (p.stem + suffix))]
        
        job = JobStatus(
            id=job_id,
            inputs=[inp], # 只有这一个文件
            outputs=single_output,
            params=req.params.model_dump(),
            status="pending", # 初始状态改为 pending
            input_size=input_size,
            duration=duration,
            progress=0.0
        )
        
        JOBS[job_id] = job
        # background_tasks.add_task(run_transcode_job, job_id)
        # executor.submit(run_transcode_job, job_id)
        created_jobs.append(job_id)
    
    # 尝试启动任务
    try_start_jobs()
    
    # 返回第一个 job_id 兼容旧前端，或者可以返回列表（前端需要适配）
    # 为了兼容现有前端（只接收一个 job_id），我们返回最后一个创建的 ID，
    # 但前端最好能刷新整个列表。
    # 实际上，现在的返回值前端并没有特别依赖 job_id 做跳转，而是刷新列表。
    # 返回 "created_count" 让前端知道创建了多少个。
    
    return {"job_id": created_jobs[-1], "status": "running", "created_count": len(created_jobs)}

@app.post("/jobs/cancel-all")
def cancel_all_jobs(current_user: User = Depends(get_current_user)):
    cancelled_count = 0
    for job_id, job in JOBS.items():
        if job.status in ["pending", "running"]:
            # If running, terminate process
            if job.status == "running" and job_id in JOB_PROCESSES:
                try:
                    JOB_PROCESSES[job_id].terminate()
                except:
                    pass
            
            job.status = "cancelled"
            cancelled_count += 1
            
    return {"message": f"已取消 {cancelled_count} 个任务", "count": cancelled_count}

@app.post("/jobs/retry-all")
def retry_all_jobs(current_user: User = Depends(get_current_user)):
    retried_count = 0
    for job in JOBS.values():
        if job.status in ["failed", "cancelled"]:
            job.status = "pending"
            job.progress = 0.0
            job.error = None
            job.completed_at = None
            job.output_size = None
            job.compression_ratio = None
            retried_count += 1
            
    if retried_count > 0:
        try_start_jobs()
        
    return {"message": f"已重置 {retried_count} 个任务", "count": retried_count}

@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, current_user: User = Depends(get_current_user)):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    job = JOBS[job_id]
    if job.status in ["completed", "failed", "cancelled"]:
        return {"status": job.status, "message": "任务已结束"}
        
    # 标记为已取消
    job.status = "cancelled"
    
    # 终止进程
    if job_id in JOB_PROCESSES:
        process = JOB_PROCESSES[job_id]
        try:
            process.terminate() # 尝试优雅终止
            # 也可以选择 kill() 强制终止
        except Exception as e:
            print(f"Error terminating process: {e}")
            
    return {"status": "cancelled", "message": "任务已中止"}

def get_path_hash(path: Path) -> str:
    """计算路径的哈希值，用于关联预览文件"""
    return hashlib.md5(str(path).encode('utf-8')).hexdigest()

@app.post("/preview")
def create_preview(req: TranscodeRequest, current_user: User = Depends(get_current_user)):
    if not req.inputs:
        raise HTTPException(status_code=400, detail="没有输入文件")
        
    input_path = Path(req.inputs[0])
    if not input_path.exists():
        raise HTTPException(status_code=400, detail="输入文件不存在")
        
    # 获取时长并计算中间点
    duration = get_video_duration(input_path)
    start_time = max(0, duration / 2 - 5) # 从中间开始，或者至少0
    
    # 生成预览文件名
    preview_filename = f"preview_{get_path_hash(input_path)}_{uuid.uuid4().hex}.mp4"
    preview_path = PREVIEW_DIR / preview_filename
    
    # 强制 mp4 格式用于 Web 预览
    # 注意：如果用户选了 mkv/mov 等，预览时最好也转为 mp4 以便浏览器播放
    # 但为了真实反映参数效果，我们应尽量保持视频编码参数，只改变封装格式?
    # 或者如果浏览器不支持该编码(如 hevc)，预览可能无法播放。
    # 这里我们假设用户参数是浏览器兼容的，或者用户只关心压缩率/画质。
    # 为了保证能播放，我们强制后缀 .mp4，但编码器使用用户参数。
    # 如果用户选了 hevc，Chrome 可能播放不了（取决于硬件），但这是预览的局限性。
    
    req.params.format = "mp4" # 强制预览为 mp4 容器
    req.params.scodec = "none" # 预览时禁用字幕，防止 TS 图形字幕(dvb_sub)转 MP4 失败
    
    # 截取 10 秒
    input_options = ["-ss", str(start_time), "-t", "10"]
    
    cmd = build_ffmpeg_cmd(input_path, preview_path, req.params, input_options)
    
    try:
        # 同步执行预览生成 (通常 10秒片段很快)
        process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if process.returncode != 0:
             raise RuntimeError(f"FFmpeg Preview Error: {process.stdout}")
             
        # 计算预估体积和压缩率
        preview_size = preview_path.stat().st_size
        source_size = input_path.stat().st_size
        
        estimate_info = {
            "source_size": source_size,
            "preview_size": preview_size,
            "duration": duration,
            "estimated_full_size": 0,
            "compression_ratio": 0.0
        }

        if duration > 0:
            # 简单估算：预览10秒 -> 完整时长
            # 注意：如果实际截取不足10秒（视频短于10秒），这里的估算会有偏差，但通常预览针对长视频
            actual_preview_duration = min(10.0, duration)
            ratio = duration / actual_preview_duration
            estimated_full_size = preview_size * ratio
            
            estimate_info["estimated_full_size"] = int(estimated_full_size)
            if source_size > 0:
                # 压缩率：(原大小 - 预估大小) / 原大小
                estimate_info["compression_ratio"] = (source_size - estimated_full_size) / source_size

        # 返回预览 URL 和 统计信息
        preview_url = f"/previews/{preview_filename}"
        return {
            "preview_url": preview_url,
            "stats": estimate_info
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 挂载静态文件（确保放在最后，避免覆盖 API 路由）
# 注意：我们需要先创建 static 目录
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 挂载预览文件目录
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/previews", StaticFiles(directory=str(PREVIEW_DIR)), name="previews")
