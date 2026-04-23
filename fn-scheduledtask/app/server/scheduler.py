#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 文件名：scheduler.py
# 作者：laok
# 日期：2026-04-01
# 描述：任务调度器
# 应用：fn-scheduledtask

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import tempfile
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Set, Callable

try:
    import grp
    import pwd
except ImportError:
    grp = None
    pwd = None

from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger


def _detect_default_account() -> str:
    for env_key in ("SCHEDULER_DEFAULT_ACCOUNT", "TRIM_USERNAME", "USERNAME", "USER"):
        value = os.environ.get(env_key)
        if value:
            return value
    try:
        euid = os.geteuid()
        if euid == 0:
            return ""
        return getpass.getuser()
    except Exception:
        return ""


DEFAULT_ACCOUNT_NAME = _detect_default_account()


# 进程管理类
class ProcessManager:
    def __init__(self):
        self._processes: Dict[int, subprocess.Popen] = {}
        self._task_id_to_pids: Dict[int, Set[int]] = {}
        self._lock = threading.Lock()

    def register(self, task_id: int, process: subprocess.Popen) -> None:
        with self._lock:
            pid = process.pid
            self._processes[pid] = process
            if task_id not in self._task_id_to_pids:
                self._task_id_to_pids[task_id] = set()
            self._task_id_to_pids[task_id].add(pid)
            logger.debug(f"Registered process {pid} for task {task_id}")

    def unregister(self, task_id: int, pid: int) -> None:
        with self._lock:
            if pid in self._processes:
                del self._processes[pid]
            if task_id in self._task_id_to_pids:
                self._task_id_to_pids[task_id].discard(pid)
                if not self._task_id_to_pids[task_id]:
                    del self._task_id_to_pids[task_id]
            logger.debug(f"Unregistered process {pid} for task {task_id}")

    def stop_task(self, task_id: int) -> bool:
        with self._lock:
            if task_id not in self._task_id_to_pids:
                logger.warning(f"No running processes for task {task_id}")
                return False

            pids = self._task_id_to_pids.get(task_id, set()).copy()
            success = True
            for pid in pids:
                process = self._processes.get(pid)
                if process:
                    try:
                        if process.poll() is None:
                            logger.info(f"Stopping process {pid} for task {task_id}")
                            try:
                                os.killpg(os.getpgid(pid), signal.SIGTERM)
                            except (ProcessLookupError, OSError):
                                process.terminate()
                            try:
                                process.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                try:
                                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                                except (ProcessLookupError, OSError):
                                    process.kill()
                                process.wait()
                    except Exception as exc:
                        logger.error(f"Failed to stop process {pid}: {exc}")
                        success = False
            return success


process_manager = ProcessManager()
ALLOWED_ACCOUNT_GIDS = (0, 1000, 1001)
POSIX_ACCOUNT_SUPPORT = os.name == "posix" and pwd is not None and grp is not None


def list_allowed_accounts() -> List[str]:
    if not POSIX_ACCOUNT_SUPPORT:
        return [DEFAULT_ACCOUNT_NAME] if DEFAULT_ACCOUNT_NAME else []

    accounts: Set[str] = set()
    try:
        for entry in pwd.getpwall():
            if entry.pw_gid in ALLOWED_ACCOUNT_GIDS:
                accounts.add(entry.pw_name)
    except Exception as exc:
        logger.warning("Failed to enumerate passwd entries: %s", exc)

    for gid in ALLOWED_ACCOUNT_GIDS:
        try:
            group = grp.getgrgid(gid)
        except KeyError:
            continue
        except Exception as exc:
            logger.warning("Failed to read group %s: %s", gid, exc)
            continue
        for member in group.gr_mem:
            if member:
                accounts.add(member)
    
    try:
        pwd.getpwnam("root")
        accounts.add("root")
    except KeyError:
        pass
    except Exception as exc:
        logger.warning("Failed to check root account: %s", exc)

    if not accounts and DEFAULT_ACCOUNT_NAME:
        accounts.add(DEFAULT_ACCOUNT_NAME)

    return sorted(accounts)


def ensure_account_allowed(account: str) -> str:
    allowed = list_allowed_accounts()
    if not allowed:
        if POSIX_ACCOUNT_SUPPORT:
            raise ValueError("no allowed accounts found in system groups 0/1000/1001")
        raise ValueError("current system cannot determine default account")
    if not POSIX_ACCOUNT_SUPPORT:
        default_account = allowed[0]
        if account and account != default_account:
            raise ValueError(
                f"Windows environment only supports using account {default_account}"
            )
        return default_account
    if account not in allowed:
        raise ValueError("account must belong to system groups 0/1000/1001")
    return account


def job_to_dict(job):
    """Convert APScheduler job to dictionary (compatible with APScheduler 3.x)"""
    return {
        "id": job.id,
        "name": job.name,
        "func": str(job.func_ref),
        "args": list(job.args) if job.args else [],
        "kwargs": dict(job.kwargs) if job.kwargs else {},
        "trigger": str(job.trigger),
        "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
    }

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 28257
DEFAULT_SOCKET_PATH = os.path.join(ROOT_DIR, "fn-scheduledtask.sock")
DEFAULT_DB_PATH = os.path.join(ROOT_DIR, "scheduler.db")
DEFAULT_SETTINGS_PATH = os.path.join(ROOT_DIR, "scheduler.settings.json")

TASK_TIMEOUT = int(os.environ.get("SCHEDULER_TASK_TIMEOUT", "900"))
RESULT_LOG_PREVIEW_LIMIT = int(os.environ.get("SCHEDULER_RESULT_LOG_PREVIEW_LIMIT", "4000"))
RESULT_RETENTION_PER_TASK = int(os.environ.get("SCHEDULER_RESULT_RETENTION_PER_TASK", "200"))

EVENT_TYPE_SCRIPT = "script"
EVENT_TYPE_BOOT = "system_boot"
EVENT_TYPE_SHUTDOWN = "system_shutdown"
EVENT_TYPES = {EVENT_TYPE_SCRIPT, EVENT_TYPE_BOOT, EVENT_TYPE_SHUTDOWN}

TRIGGER_TYPE_CRON = "cron"
TRIGGER_TYPE_INTERVAL = "interval"
TRIGGER_TYPE_DATE = "date"
TRIGGER_TYPE_BOOT = "boot"
TRIGGER_TYPE_SHUTDOWN = "shutdown"

TRIGGER_TYPES = {TRIGGER_TYPE_CRON, TRIGGER_TYPE_INTERVAL, TRIGGER_TYPE_DATE, TRIGGER_TYPE_BOOT, TRIGGER_TYPE_SHUTDOWN}

logger = logging.getLogger("fn-scheduledtask")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


def _get_db_path(db_path: str) -> str:
    if os.path.isabs(db_path):
        return db_path
    return os.path.join(ROOT_DIR, db_path)


def _get_settings_path(settings_path: str) -> str:
    if os.path.isabs(settings_path):
        return settings_path
    return os.path.join(ROOT_DIR, settings_path)


def _ensure_dir(path: str) -> None:
    dir_path = os.path.dirname(path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)


def _get_timezone() -> str:
    """Get timezone from environment or use default"""
    tz = os.environ.get("TZ")
    if tz:
        return tz
    return "Asia/Shanghai"


def _timestamp_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def serialize_result_row(row: Dict[str, Any], include_log: bool = True, log_limit: Optional[int] = None) -> Dict[str, Any]:
    payload = dict(row)
    log_text = payload.get("log") or ""
    if not isinstance(log_text, str):
        log_text = str(log_text)

    log_size = len(log_text)
    if log_limit is not None and log_limit >= 0:
        log_preview = log_text[:log_limit]
        log_truncated = log_size > log_limit
    else:
        log_preview = log_text
        log_truncated = False

    payload["log_size"] = log_size
    payload["log_preview"] = log_preview
    payload["log_truncated"] = log_truncated

    if include_log:
        payload["log"] = log_text
    else:
        payload.pop("log", None)

    return payload


class SchedulerSettings:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.RLock()
        self._data = {
            "task_timeout": TASK_TIMEOUT,
            "result_log_preview_limit": RESULT_LOG_PREVIEW_LIMIT,
            "result_retention_per_task": RESULT_RETENTION_PER_TASK,
        }
        self._load()

    def _sanitize(self, raw: Dict[str, Any]) -> Dict[str, int]:
        data = dict(self._data)

        def _read_int(key: str, minimum: int) -> None:
            if key not in raw:
                return
            value = int(raw[key])
            if value < minimum:
                raise ValueError(f"{key} must be >= {minimum}")
            data[key] = value

        _read_int("task_timeout", 0)
        _read_int("result_log_preview_limit", 256)
        _read_int("result_retention_per_task", 0)
        return data

    def _load(self) -> None:
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as fp:
                loaded = json.load(fp)
            if isinstance(loaded, dict):
                with self._lock:
                    self._data = self._sanitize(loaded)
        except Exception as exc:
            logger.warning("Failed to load settings from %s: %s", self.path, exc)

    def _save(self) -> None:
        _ensure_dir(self.path)
        fd, tmp_path = tempfile.mkstemp(prefix="scheduler-settings-", suffix=".json", dir=os.path.dirname(self.path) or None)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fp:
                json.dump(self._data, fp, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp_path, self.path)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    def to_dict(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._data)

    def update(self, raw: Dict[str, Any]) -> Dict[str, int]:
        with self._lock:
            self._data = self._sanitize(raw)
            self._save()
            return dict(self._data)

    @property
    def task_timeout(self) -> int:
        with self._lock:
            return int(self._data["task_timeout"])

    @property
    def result_retention_per_task(self) -> int:
        with self._lock:
            return int(self._data["result_retention_per_task"])

    @property
    def result_log_preview_limit(self) -> int:
        with self._lock:
            return int(self._data["result_log_preview_limit"])


class TaskDatabase:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.RLock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path, timeout=30)

    def _init_db(self) -> None:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tasks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        trigger_type TEXT NOT NULL,
                        trigger_config TEXT,
                        task_type TEXT NOT NULL,
                        task_func TEXT,
                        task_script TEXT,
                        enabled INTEGER DEFAULT 1,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        account TEXT
                    )
                    """
                )
                cursor.execute(
                    "PRAGMA table_info(tasks)"
                )
                columns = [row[1] for row in cursor.fetchall()]
                if "account" not in columns:
                    cursor.execute("ALTER TABLE tasks ADD COLUMN account TEXT")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_results (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        task_id INTEGER NOT NULL,
                        task_name TEXT NOT NULL,
                        started_at TEXT NOT NULL,
                        finished_at TEXT,
                        exit_code INTEGER,
                        log TEXT,
                        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS task_templates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        key TEXT NOT NULL UNIQUE,
                        name TEXT NOT NULL,
                        script_body TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id, name, trigger_type, trigger_config, task_type, task_func, task_script, enabled, created_at, updated_at, account FROM tasks ORDER BY id"
                )
                rows = cursor.fetchall()
                return [
                    {
                        "id": row[0],
                        "name": row[1],
                        "trigger_type": row[2],
                        "trigger_config": json.loads(row[3]) if row[3] else None,
                        "task_type": row[4],
                        "task_func": row[5],
                        "task_script": row[6],
                        "enabled": bool(row[7]),
                        "created_at": row[8],
                        "updated_at": row[9],
                        "account": row[10],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def get_task_by_id(self, task_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id, name, trigger_type, trigger_config, task_type, task_func, task_script, enabled, created_at, updated_at, account FROM tasks WHERE id = ?",
                    (task_id,),
                )
                row = cursor.fetchone()
                if not row:
                    return None
                return {
                    "id": row[0],
                    "name": row[1],
                    "trigger_type": row[2],
                    "trigger_config": json.loads(row[3]) if row[3] else None,
                    "task_type": row[4],
                    "task_func": row[5],
                    "task_script": row[6],
                    "enabled": bool(row[7]),
                    "created_at": row[8],
                    "updated_at": row[9],
                    "account": row[10],
                }
            finally:
                conn.close()

    def create_task(self, name: str, trigger_type: str, trigger_config: Optional[Dict], task_type: str, task_func: Optional[str], task_script: Optional[str], account: Optional[str] = None) -> int:
        now = _timestamp_now()
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO tasks (name, trigger_type, trigger_config, task_type, task_func, task_script, enabled, created_at, updated_at, account) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
                    (name, trigger_type, json.dumps(trigger_config) if trigger_config else None, task_type, task_func, task_script, now, now, account),
                )
                conn.commit()
                return cursor.lastrowid
            finally:
                conn.close()

    def update_task(self, task_id: int, name: str, trigger_type: str, trigger_config: Optional[Dict], task_type: str, task_func: Optional[str], task_script: Optional[str], enabled: bool, account: Optional[str] = None) -> bool:
        now = _timestamp_now()
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE tasks SET name=?, trigger_type=?, trigger_config=?, task_type=?, task_func=?, task_script=?, enabled=?, updated_at=?, account=? WHERE id=?",
                    (name, trigger_type, json.dumps(trigger_config) if trigger_config else None, task_type, task_func, task_script, int(enabled), now, account, task_id),
                )
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def delete_task(self, task_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM tasks WHERE id=?", (task_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def set_task_enabled(self, task_id: int, enabled: bool) -> bool:
        now = _timestamp_now()
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("UPDATE tasks SET enabled=?, updated_at=? WHERE id=?", (int(enabled), now, task_id))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def add_result(self, task_id: int, task_name: str, started_at: str, finished_at: Optional[str], exit_code: Optional[int], log: Optional[str]) -> int:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO task_results (task_id, task_name, started_at, finished_at, exit_code, log) VALUES (?, ?, ?, ?, ?, ?)",
                    (task_id, task_name, started_at, finished_at, exit_code, log),
                )
                conn.commit()
                return cursor.lastrowid
            finally:
                conn.close()

    def get_results(self, task_id: int, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id, task_id, task_name, started_at, finished_at, exit_code, log FROM task_results WHERE task_id=? ORDER BY started_at DESC LIMIT ?",
                    (task_id, limit),
                )
                rows = cursor.fetchall()
                return [
                    {
                        "id": row[0],
                        "task_id": row[1],
                        "task_name": row[2],
                        "started_at": row[3],
                        "finished_at": row[4],
                        "exit_code": row[5],
                        "log": row[6],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def clear_results(self, task_id: int) -> int:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM task_results WHERE task_id=?", (task_id,))
                conn.commit()
                return cursor.rowcount
            finally:
                conn.close()

    def cleanup_old_results(self, retention: int) -> int:
        if retention <= 0:
            return 0
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    DELETE FROM task_results WHERE id IN (
                        SELECT id FROM task_results ORDER BY started_at DESC LIMIT -1 OFFSET ?
                    )
                    """,
                    (retention,),
                )
                conn.commit()
                return cursor.rowcount
            finally:
                conn.close()

    def get_all_templates(self) -> List[Dict[str, Any]]:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT id, key, name, script_body, created_at FROM task_templates ORDER BY id")
                rows = cursor.fetchall()
                return [{"id": row[0], "key": row[1], "name": row[2], "script_body": row[3], "created_at": row[4]} for row in rows]
            finally:
                conn.close()

    def create_template(self, key: str, name: str, script_body: str) -> int:
        now = _timestamp_now()
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO task_templates (key, name, script_body, created_at) VALUES (?, ?, ?, ?)", (key, name, script_body, now))
                conn.commit()
                return cursor.lastrowid
            finally:
                conn.close()

    def delete_template(self, template_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM task_templates WHERE id=?", (template_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()


class TaskScheduler:
    def __init__(self, db: TaskDatabase, settings: SchedulerSettings, tasks_dir: str):
        self.db = db
        self.settings = settings
        self.tasks_dir = tasks_dir
        self.timezone = _get_timezone()
        self.scheduler = BackgroundScheduler(timezone=self.timezone)
        self._running_jobs: Dict[str, threading.Thread] = {}
        self._sys_event_listeners: List[callable] = []
        self._init_scheduler()
        self._register_system_events()

    def _init_scheduler(self) -> None:
        self.scheduler.add_listener(self._on_job_executed, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    def _register_system_events(self) -> None:
        pass

    def _on_job_executed(self, event) -> None:
        if hasattr(event, "job_id"):
            task_id = event.job_id
            if task_id.startswith("boot_") or task_id.startswith("shutdown_"):
                return

    def _execute_python_function(self, task_func: str, task_id: int, task_name: str) -> tuple[int, str]:
        log_lines = []
        try:
            sys.path.insert(0, self.tasks_dir)
            if ":" in task_func:
                module_name, func_name = task_func.rsplit(":", 1)
                spec = __import__(module_name, fromlist=[func_name])
                func = getattr(spec, func_name)
            else:
                parts = task_func.rsplit(".", 1)
                if len(parts) == 2:
                    module_name, func_name = parts
                    spec = __import__(module_name, fromlist=[func_name])
                    func = getattr(spec, func_name)
                else:
                    raise ValueError(f"Invalid task function format: {task_func}")
            log_lines.append(f"[{_timestamp_now()}] Starting Python function: {task_func}")
            logger.info(f"[Task {task_id}] {log_lines[-1]}")
            result = func(task_id, task_name)
            log_lines.append(f"[{_timestamp_now()}] Function completed successfully")
            logger.info(f"[Task {task_id}] {log_lines[-1]}")
            return 0, "\n".join(log_lines)
        except Exception as exc:
            log_lines.append(f"[{_timestamp_now()}] Error: {exc}")
            logger.error(f"[Task {task_id}] {log_lines[-1]}", exc_info=True)
            import traceback
            log_lines.append(f"[traceback]\n{traceback.format_exc()}")
            return 1, "\n".join(log_lines)
        finally:
            if self.tasks_dir in sys.path:
                sys.path.remove(self.tasks_dir)

    def _prepare_account_context(self, account: Optional[str]) -> tuple[Optional[Callable[[], None]], Optional[str]]:
        if not POSIX_ACCOUNT_SUPPORT:
            return (None, None)
        if not account:
            return (None, None)
        try:
            pw_record = pwd.getpwnam(account)
        except KeyError as exc:
            raise RuntimeError(
                f"account {account} does not exist, cannot execute task"
            ) from exc

        target_uid = pw_record.pw_uid
        target_gid = pw_record.pw_gid
        current_uid = os.geteuid()

        cwd = None
        if os.path.isdir(pw_record.pw_dir):
            cwd = pw_record.pw_dir
        else:
            logger.warning(f"Home directory {pw_record.pw_dir} for account {account} does not exist, not setting working directory")

        if current_uid == target_uid:
            return (None, cwd)

        if current_uid != 0:
            raise PermissionError(
                "scheduler service must run as root to switch task execution account"
            )

        supplemental: List[int] = []
        try:
            supplemental = [entry.gr_gid for entry in grp.getgrall() if account in entry.gr_mem]
        except Exception as exc:
            logger.warning(
                "failed to get supplemental groups for account %s: %s", account, exc
            )

        groups = sorted(set([target_gid, *supplemental]))

        def _changer() -> None:
            os.setgid(target_gid)
            if groups:
                os.setgroups(groups)
            os.setuid(target_uid)

        return (_changer, cwd)

    def _execute_script(self, script: str, task_id: int, task_name: str, account: Optional[str] = None) -> tuple[int, str]:
        log_lines = []
        script_path = None
        process = None
        try:
            preexec_fn, cwd = self._prepare_account_context(account)
            
            with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False, encoding="utf-8") as f:
                f.write(script)
                script_path = f.name
            
            os.chmod(script_path, 0o755)
            
            log_lines.append(f"[{_timestamp_now()}] Executing script at: {script_path}")
            if account:
                log_lines.append(f"[{_timestamp_now()}] Running as account: {account}")
            logger.info(f"[Task {task_id}] {log_lines[-1]}")
            
            if preexec_fn:
                def wrapped_preexec_fn():
                    os.setpgrp()
                    preexec_fn()
            else:
                def wrapped_preexec_fn():
                    os.setpgrp()
            
            process = subprocess.Popen(
                ["bash", script_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=wrapped_preexec_fn,
                cwd=cwd,
            )
            process_manager.register(task_id, process)
            
            try:
                stdout, stderr = process.communicate(timeout=self.settings.task_timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
                log_lines.append(f"[{_timestamp_now()}] Script timed out after {self.settings.task_timeout} seconds")
                logger.error(f"[Task {task_id}] {log_lines[-1]}")
                return 124, "\n".join(log_lines)
            finally:
                process_manager.unregister(task_id, process.pid)
            
            log_lines.append(f"[{_timestamp_now()}] Exit code: {process.returncode}")
            logger.info(f"[Task {task_id}] {log_lines[-1]}")
            if stdout:
                log_lines.append(f"[stdout]\n{stdout}")
                logger.info(f"[Task {task_id}] stdout:\n{stdout}")
            if stderr:
                log_lines.append(f"[stderr]\n{stderr}")
                logger.error(f"[Task {task_id}] stderr:\n{stderr}")
            return process.returncode, "\n".join(log_lines)
        except Exception as exc:
            log_lines.append(f"[{_timestamp_now()}] Error: {exc}")
            logger.error(f"[Task {task_id}] {log_lines[-1]}", exc_info=True)
            import traceback
            log_lines.append(f"[traceback]\n{traceback.format_exc()}")
            return 1, "\n".join(log_lines)
        finally:
            if process and process.poll() is None:
                try:
                    process.kill()
                except Exception:
                    pass
            if script_path and os.path.exists(script_path):
                try:
                    os.unlink(script_path)
                except Exception:
                    pass

    def _run_task(self, task_id: int, task_name: str, task_type: str, task_func: Optional[str], task_script: Optional[str], account: Optional[str] = None) -> None:
        logger.info(f"Starting task execution: task_id={task_id}, name={task_name}, type={task_type}")
        started_at = _timestamp_now()
        log = ""

        if task_type == "python":
            exit_code, log = self._execute_python_function(task_func or "", task_id, task_name)
        elif task_type == "shell":
            exit_code, log = self._execute_script(task_script or "", task_id, task_name, account)
        else:
            exit_code, log = 1, f"Unknown task type: {task_type}"

        finished_at = _timestamp_now()
        logger.info(f"Task completed: task_id={task_id}, exit_code={exit_code}")
        try:
            result_id = self.db.add_result(task_id, task_name, started_at, finished_at, exit_code, log)
            logger.info(f"Result saved: task_id={task_id}, result_id={result_id}")
        except Exception as e:
            logger.error(f"Failed to save result: {e}", exc_info=True)

        if self.settings.result_retention_per_task > 0:
            try:
                self.db.cleanup_old_results(self.settings.result_retention_per_task)
            except Exception as e:
                logger.error(f"Failed to cleanup old results: {e}")

    def add_job(self, task: Dict[str, Any]) -> bool:
        try:
            job_id = str(task["id"])
            name = task["name"]
            trigger_type = task["trigger_type"]
            task_type = task["task_type"]
            task_func = task.get("task_func")
            task_script = task.get("task_script")
            account = task.get("account")

            if trigger_type == TRIGGER_TYPE_BOOT:
                return True
            elif trigger_type == TRIGGER_TYPE_SHUTDOWN:
                return True
            elif trigger_type == TRIGGER_TYPE_DATE:
                trigger_config = task.get("trigger_config", {})
                run_date = trigger_config.get("run_date")
                if not run_date:
                    logger.error(f"[add_job] Date trigger missing run_date for task {job_id}")
                    return False
                
                if len(run_date) == 16 and run_date[10] == 'T':
                    run_date = run_date + ":00"
                
                trigger = DateTrigger(run_date=run_date, timezone=self.timezone)
            elif trigger_type == TRIGGER_TYPE_INTERVAL:
                trigger_config = task.get("trigger_config", {})
                seconds = trigger_config.get("seconds", 60)
                trigger = IntervalTrigger(seconds=seconds)
            elif trigger_type == TRIGGER_TYPE_CRON:
                trigger_config = task.get("trigger_config", {})
                trigger = CronTrigger(
                    minute=trigger_config.get("minute", "*"),
                    hour=trigger_config.get("hour", "*"),
                    day=trigger_config.get("day", "*"),
                    month=trigger_config.get("month", "*"),
                    day_of_week=trigger_config.get("day_of_week", "*"),
                    timezone=self.timezone,
                )
            else:
                logger.error(f"Unknown trigger type: {trigger_type}")
                return False

            self.scheduler.add_job(
                func=self._run_task,
                trigger=trigger,
                id=job_id,
                name=name,
                args=[task["id"], name, task_type, task_func, task_script, account],
                replace_existing=True,
            )
            return True
        except Exception as exc:
            logger.error(f"Failed to add job: {exc}", exc_info=True)
            return False

    def remove_job(self, job_id: str) -> bool:
        try:
            self.scheduler.remove_job(job_id)
            return True
        except Exception:
            return False

    def start(self) -> None:
        if not self.scheduler.running:
            self.scheduler.start()
            logger.info("Scheduler started")

    def shutdown(self, wait: bool = True) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=wait)
            logger.info("Scheduler stopped")

    def trigger_boot_tasks(self) -> None:
        tasks = self.db.get_all_tasks()
        for task in tasks:
            if task["enabled"] and task["trigger_type"] == TRIGGER_TYPE_BOOT:
                logger.info(f"Triggering boot task: {task['name']}")
                thread = threading.Thread(target=self._run_task, args=[task["id"], task["name"], task["task_type"], task.get("task_func"), task.get("task_script"), task.get("account")])
                thread.start()

    def trigger_shutdown_tasks(self) -> None:
        tasks = self.db.get_all_tasks()
        for task in tasks:
            if task["enabled"] and task["trigger_type"] == TRIGGER_TYPE_SHUTDOWN:
                logger.info(f"Triggering shutdown task: {task['name']}")
                thread = threading.Thread(target=self._run_task, args=[task["id"], task["name"], task["task_type"], task.get("task_func"), task.get("task_script"), task.get("account")])
                thread.start()

    def get_jobs(self) -> List[Dict[str, Any]]:
        jobs = self.scheduler.get_jobs()
        result = []
        for job in jobs:
            job_dict = job_to_dict(job)
            task_id = int(job.id)
            task = self.db.get_task_by_id(task_id)
            if task:
                job_dict["enabled"] = task["enabled"]
                job_dict["task_type"] = task["task_type"]
                job_dict["task_func"] = task.get("task_func")
                job_dict["task_script"] = task.get("task_script")
            result.append(job_dict)
        return result

    def reload_all_jobs(self) -> int:
        """Reload all jobs from database to scheduler"""
        count = 0
        self.scheduler.remove_all_jobs()
        
        all_tasks = self.db.get_all_tasks()
        
        for task in all_tasks:
            if task["enabled"]:
                success = self.add_job(task)
                if success:
                    count += 1
        
        return count


class ApiHandler(BaseHTTPRequestHandler):
    def address_string(self):
        try:
            return super().address_string()
        except (IndexError, ValueError):
            return "unix_socket"

    def log_message(self, format, *args):
        logger.info("%s - %s", self.address_string(), format % args)

    def send_json(self, data: Dict[str, Any], status: int = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def get_int_param(self, params: Dict[str, str], key: str, default: int = 0) -> int:
        value = params.get(key)
        if value:
            try:
                return int(value)
            except ValueError:
                pass
        return default

    def get_bool_param(self, params: Dict[str, str], key: str, default: bool = False) -> bool:
        value = params.get(key)
        if value:
            return value.lower() in ("1", "true", "yes")
        return default

    def get_scheduler(self) -> TaskScheduler:
        return self.server.scheduler

    def get_db(self) -> TaskDatabase:
        return self.server.db

    def get_settings(self) -> SchedulerSettings:
        return self.server.settings

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json({"status": "ok", "timestamp": _timestamp_now()})
            return

        if self.path == "/api/accounts":
            service_can_switch_account = False
            if POSIX_ACCOUNT_SUPPORT:
                try:
                    service_can_switch_account = os.geteuid() == 0
                except Exception:
                    pass
            payload = {
                "data": list_allowed_accounts(),
                "meta": {
                    "posix_supported": POSIX_ACCOUNT_SUPPORT,
                    "default_account": DEFAULT_ACCOUNT_NAME,
                    "service_can_switch_account": service_can_switch_account,
                },
            }
            self.send_json(payload)
            return

        if self.path == "/api/tasks/reload":
            count = self.get_scheduler().reload_all_jobs()
            self.send_json({"data": {"reloaded": count}})
            return

        if self.path == "/api/tasks":
            tasks = self.get_db().get_all_tasks()
            jobs = self.get_scheduler().get_jobs()
            job_map = {job["id"]: job for job in jobs}
            
            result = []
            for task in tasks:
                task_id_str = str(task["id"])
                job = job_map.get(task_id_str)
                task_item = {
                    "id": task["id"],
                    "name": task["name"],
                    "trigger_type": task["trigger_type"],
                    "trigger_config": task["trigger_config"],
                    "task_type": task["task_type"],
                    "task_func": task.get("task_func"),
                    "task_script": task.get("task_script"),
                    "enabled": task["enabled"],
                    "account": task.get("account"),
                    "next_run_time": job.get("next_run_time") if job else None,
                }
                result.append(task_item)
            
            self.send_json({"data": result})
            return

        if self.path.startswith("/api/tasks/"):
            parts = self.path.split("/")
            
            if len(parts) == 4 and parts[3] == "results":
                pass
            elif len(parts) >= 5 and parts[4] == "results":
                pass
            else:
                task_id_str = parts[3].split("?")[0]
                try:
                    task_id = int(task_id_str)
                except ValueError:
                    self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                    return

                task = self.get_db().get_task_by_id(task_id)
                if not task:
                    self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                    return
                self.send_json({"data": task})
                return

        if self.path.startswith("/api/tasks/") and "/results" in self.path:
            parts = self.path.split("/")
            try:
                task_id = int(parts[3])
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return
            limit = self.get_int_param({}, "limit", 100)
            results = self.get_db().get_results(task_id, limit)
            self.send_json({"data": [serialize_result_row(r) for r in results]})
            return

        if self.path == "/api/templates":
            templates = self.get_db().get_all_templates()
            self.send_json({"data": templates})
            return

        if self.path == "/api/settings":
            self.send_json({"data": self.get_settings().to_dict()})
            return

        if self.path.startswith("/api/tasks/") and parts[-1] == "run":
            task_id_str = self.path.split("/")[3]
            try:
                task_id = int(task_id_str)
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            task = self.get_db().get_task_by_id(task_id)
            if not task:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                return

            thread = threading.Thread(target=self.get_scheduler()._run_task, args=[task["id"], task["name"], task["task_type"], task.get("task_func"), task.get("task_script"), task.get("account")])
            thread.start()
            self.send_json({"status": "triggered"})
            return

        if self.path.startswith("/api/tasks/") and parts[-1] == "stop":
            task_id_str = self.path.split("/")[3]
            try:
                task_id = int(task_id_str)
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            task = self.get_db().get_task_by_id(task_id)
            if not task:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                return

            success = process_manager.stop_task(task_id)
            if success:
                self.send_json({"status": "stopped"})
            else:
                self.send_json({"status": "no_running_processes"})
            return

        if self.path == "/api/functions":
            tasks_dir = self.get_scheduler().tasks_dir
            functions = []
            if os.path.exists(tasks_dir):
                for filename in os.listdir(tasks_dir):
                    if filename.endswith(".py") and filename not in ("__init__.py", "task_methods.py"):
                        module_name = filename[:-3]
                        functions.append({"module": module_name, "type": "python"})
            self.send_json({"data": functions})
            return

        if self.path == "/api/scripts":
            tasks_dir = self.get_scheduler().tasks_dir
            scripts = []
            if os.path.exists(tasks_dir):
                for filename in os.listdir(tasks_dir):
                    if filename.endswith(".py") or filename.endswith(".sh"):
                        filepath = os.path.join(tasks_dir, filename)
                        stat = os.stat(filepath)
                        scripts.append({
                            "name": filename,
                            "type": "python" if filename.endswith(".py") else "shell",
                            "size": stat.st_size,
                            "modified": stat.st_mtime
                        })
            self.send_json({"data": scripts})
            return

        if self.path.startswith("/api/scripts/"):
            parts = self.path.split("/")
            if len(parts) == 4:
                filename = parts[3]
                tasks_dir = self.get_scheduler().tasks_dir
                filepath = os.path.join(tasks_dir, filename)
                
                if not os.path.exists(filepath):
                    self.send_json({"error": "Script not found"}, HTTPStatus.NOT_FOUND)
                    return
                
                if not (filename.endswith(".py") or filename.endswith(".sh")):
                    self.send_json({"error": "Invalid file type"}, HTTPStatus.BAD_REQUEST)
                    return
                
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                self.send_json({"data": {"name": filename, "content": content}})
                return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        if self.path == "/api/tasks":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
                logger.info(f"[POST /api/tasks] Received data: {data}")
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            name = data.get("name")
            trigger_type = data.get("trigger_type")
            trigger_config = data.get("trigger_config")
            task_type = data.get("task_type")
            task_func = data.get("task_func")
            task_script = data.get("task_script")
            account = data.get("account")

            if account:
                try:
                    account = ensure_account_allowed(account)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                    return

            if not name or not trigger_type or not task_type:
                self.send_json({"error": "Missing required fields"}, HTTPStatus.BAD_REQUEST)
                return

            logger.info(f"[POST /api/tasks] Creating task: name={name}, trigger_type={trigger_type}, trigger_config={trigger_config}")
            task_id = self.get_db().create_task(name, trigger_type, trigger_config, task_type, task_func, task_script, account)
            logger.info(f"[POST /api/tasks] Task created: id={task_id}")

            task = self.get_db().get_task_by_id(task_id)
            logger.info(f"[POST /api/tasks] Task from DB: {task}")
            if task and task["enabled"]:
                logger.info(f"[POST /api/tasks] Adding task to scheduler...")
                self.get_scheduler().add_job(task)

            self.send_json({"status": "created", "id": task_id}, HTTPStatus.CREATED)
            return

        if self.path.startswith("/api/tasks/") and self.path.endswith("/run"):
            task_id_str = self.path.split("/")[3]
            try:
                task_id = int(task_id_str)
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            task = self.get_db().get_task_by_id(task_id)
            if not task:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                return

            thread = threading.Thread(target=self.get_scheduler()._run_task, args=[task["id"], task["name"], task["task_type"], task.get("task_func"), task.get("task_script"), task.get("account")])
            thread.start()
            self.send_json({"status": "triggered"})
            return

        if self.path.startswith("/api/tasks/") and self.path.endswith("/stop"):
            task_id_str = self.path.split("/")[3]
            try:
                task_id = int(task_id_str)
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            task = self.get_db().get_task_by_id(task_id)
            if not task:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                return

            success = process_manager.stop_task(task_id)
            if success:
                self.send_json({"status": "stopped"})
            else:
                self.send_json({"status": "no_running_processes"})
            return

        if self.path == "/api/templates":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            key = data.get("key")
            name = data.get("name")
            script_body = data.get("script_body")

            if not key or not name or not script_body:
                self.send_json({"error": "Missing required fields"}, HTTPStatus.BAD_REQUEST)
                return

            template_id = self.get_db().create_template(key, name, script_body)
            self.send_json({"status": "created", "id": template_id}, HTTPStatus.CREATED)
            return

        if self.path == "/api/settings":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            updated = self.get_settings().update(data)
            self.send_json({"status": "updated", "data": updated})
            return

        if self.path == "/api/tasks/clear-results":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            task_id = data.get("task_id")
            if not task_id:
                self.send_json({"error": "Missing task_id"}, HTTPStatus.BAD_REQUEST)
                return

            count = self.get_db().clear_results(task_id)
            self.send_json({"status": "cleared", "count": count})
            return

        if self.path == "/api/scripts":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            filename = data.get("name")
            content = data.get("content", "")

            if not filename:
                self.send_json({"error": "Filename is required"}, HTTPStatus.BAD_REQUEST)
                return

            if not (filename.endswith(".py") or filename.endswith(".sh")):
                self.send_json({"error": "Only .py or .sh files are allowed"}, HTTPStatus.BAD_REQUEST)
                return

            if ".." in filename or "/" in filename or "\\" in filename:
                self.send_json({"error": "Invalid filename"}, HTTPStatus.BAD_REQUEST)
                return

            tasks_dir = self.get_scheduler().tasks_dir
            os.makedirs(tasks_dir, exist_ok=True)
            filepath = os.path.join(tasks_dir, filename)

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)

            if filename.endswith(".sh"):
                os.chmod(filepath, 0o755)

            self.send_json({"status": "saved", "name": filename})
            return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        if self.path.startswith("/api/tasks/"):
            parts = self.path.split("/")
            if len(parts) < 4:
                self.send_json({"error": "Invalid path"}, HTTPStatus.BAD_REQUEST)
                return

            try:
                task_id = int(parts[3])
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)
                logger.info(f"[PUT /api/tasks/{task_id}] Received data: {data}")
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            name = data.get("name")
            trigger_type = data.get("trigger_type")
            trigger_config = data.get("trigger_config")
            task_type = data.get("task_type")
            task_func = data.get("task_func")
            task_script = data.get("task_script")
            enabled = data.get("enabled", True)
            account = data.get("account")

            if account:
                try:
                    account = ensure_account_allowed(account)
                except ValueError as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                    return

            if not name or not trigger_type or not task_type:
                self.send_json({"error": "Missing required fields"}, HTTPStatus.BAD_REQUEST)
                return

            old_task = self.get_db().get_task_by_id(task_id)
            if not old_task:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
                return

            logger.info(f"[PUT /api/tasks/{task_id}] Updating task...")
            self.get_db().update_task(task_id, name, trigger_type, trigger_config, task_type, task_func, task_script, enabled, account)
            logger.info(f"[PUT /api/tasks/{task_id}] Removing old job from scheduler...")
            self.get_scheduler().remove_job(str(task_id))

            if enabled:
                task = self.get_db().get_task_by_id(task_id)
                logger.info(f"[PUT /api/tasks/{task_id}] Task from DB: {task}")
                if task:
                    logger.info(f"[PUT /api/tasks/{task_id}] Adding new job to scheduler...")
                    self.get_scheduler().add_job(task)

            self.send_json({"status": "updated"})
            return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        if self.path.startswith("/api/tasks/"):
            parts = self.path.split("/")
            if len(parts) < 4:
                self.send_json({"error": "Invalid path"}, HTTPStatus.BAD_REQUEST)
                return

            task_id_str = parts[3].split("?")[0]
            try:
                task_id = int(task_id_str)
            except ValueError:
                self.send_json({"error": "Invalid task ID"}, HTTPStatus.BAD_REQUEST)
                return

            self.get_scheduler().remove_job(str(task_id))
            deleted = self.get_db().delete_task(task_id)

            if deleted:
                self.send_json({"status": "deleted"})
            else:
                self.send_json({"error": "Task not found"}, HTTPStatus.NOT_FOUND)
            return

        if self.path.startswith("/api/templates/"):
            parts = self.path.split("/")
            try:
                template_id = int(parts[3])
            except ValueError:
                self.send_json({"error": "Invalid template ID"}, HTTPStatus.BAD_REQUEST)
                return

            deleted = self.get_db().delete_template(template_id)
            if deleted:
                self.send_json({"status": "deleted"})
            else:
                self.send_json({"error": "Template not found"}, HTTPStatus.NOT_FOUND)
            return

        if self.path.startswith("/api/scripts/"):
            parts = self.path.split("/")
            if len(parts) == 4:
                filename = parts[3]
                
                if not filename:
                    self.send_json({"error": "Filename is required"}, HTTPStatus.BAD_REQUEST)
                    return
                
                if not (filename.endswith(".py") or filename.endswith(".sh")):
                    self.send_json({"error": "Invalid file type"}, HTTPStatus.BAD_REQUEST)
                    return
                
                if ".." in filename or "/" in filename or "\\" in filename:
                    self.send_json({"error": "Invalid filename"}, HTTPStatus.BAD_REQUEST)
                    return
                
                if filename in ("__init__.py", "task_methods.py"):
                    self.send_json({"error": "Cannot delete system files"}, HTTPStatus.BAD_REQUEST)
                    return
                
                tasks_dir = self.get_scheduler().tasks_dir
                filepath = os.path.join(tasks_dir, filename)
                
                if not os.path.exists(filepath):
                    self.send_json({"error": "Script not found"}, HTTPStatus.NOT_FOUND)
                    return
                
                os.remove(filepath)
                self.send_json({"status": "deleted"})
                return

        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)


class FnScheduledTaskServer(ThreadingHTTPServer):
    allow_reuse_address = True
    block_on_close = False

    def __init__(
        self,
        host: str,
        port: int,
        scheduler: TaskScheduler,
        db: TaskDatabase,
        settings: SchedulerSettings,
        unix_socket_path: Optional[str] = None,
    ):
        self.scheduler = scheduler
        self.db = db
        self.settings = settings
        self._shutdown_event = threading.Event()
        self._unix_socket_path = unix_socket_path
        self._created_unix_socket = False

        if unix_socket_path:
            super().__init__(("", 0), ApiHandler, bind_and_activate=False)
            try:
                if os.path.exists(unix_socket_path):
                    os.unlink(unix_socket_path)
            except Exception:
                pass
            uds = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            uds.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            uds.bind(unix_socket_path)
            self.socket = uds
            self.address_family = socket.AF_UNIX
            self.server_address = unix_socket_path
            self.server_activate()
        else:
            super().__init__((host, port), ApiHandler)


def main():
    parser = argparse.ArgumentParser(description="fn-scheduledtask scheduler server")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind to")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")
    parser.add_argument("--unix-socket", dest="unix_socket", help="Unix socket path (alternative to host:port)")
    parser.add_argument("--db", default="scheduler.db", help="Path to SQLite database")
    parser.add_argument("--settings", default="scheduler.settings.json", help="Path to settings file")
    parser.add_argument("--tasks-dir", dest="tasks_dir", default=None, help="Path to tasks directory")
    args = parser.parse_args()

    db_path = _get_db_path(args.db)
    settings_path = _get_settings_path(args.settings)
    tasks_dir = args.tasks_dir or os.path.join(ROOT_DIR, "tasks")

    _ensure_dir(db_path)
    _ensure_dir(settings_path)

    db = TaskDatabase(db_path)
    settings = SchedulerSettings(settings_path)
    scheduler = TaskScheduler(db, settings, tasks_dir)

    logger.info("[main] Loading tasks from database...")
    all_tasks = db.get_all_tasks()
    logger.info(f"[main] Found {len(all_tasks)} tasks in DB")
    for task in all_tasks:
        logger.info(f"[main] Task {task['id']}: name={task['name']}, enabled={task['enabled']}, trigger_type={task['trigger_type']}")
        if task["enabled"]:
            success = scheduler.add_job(task)
            logger.info(f"[main]   Added to scheduler: {success}")

    scheduler.start()
    logger.info(f"[main] After scheduler.start(), jobs count: {len(scheduler.get_jobs())}")
    scheduler.trigger_boot_tasks()

    server = FnScheduledTaskServer(
        args.host,
        args.port,
        scheduler,
        db,
        settings,
        unix_socket_path=args.unix_socket,
    )

    def signal_handler(signum, frame):
        logger.info("Received signal %d, shutting down...", signum)
        scheduler.trigger_shutdown_tasks()
        scheduler.shutdown(wait=False)
        server.shutdown()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    if args.unix_socket:
        logger.info("Server starting on unix socket: %s", args.unix_socket)
    else:
        logger.info("Server starting on %s:%d", args.host, args.port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        scheduler.trigger_shutdown_tasks()
        scheduler.shutdown(wait=True)
        if args.unix_socket and os.path.exists(args.unix_socket):
            try:
                os.unlink(args.unix_socket)
            except Exception:
                pass


if __name__ == "__main__":
    main()
