#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Built-in task methods for fn-scheduledtask.
Add your custom task functions here.
"""


def hello_world(task_id, task_name):
    """Demo task: Hello World"""
    print(f"Hello, World! Task '{task_name}' (ID: {task_id}) executed at UTC {__import__('datetime').datetime.now()}")


def log_timestamp(task_id, task_name):
    """Demo task: Log current timestamp"""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    print(f"Task '{task_name}' (ID: {task_id}) executed at {now.isoformat()}")


def check_system_status(task_id, task_name):
    """Demo task: Check system status"""
    import os
    import psutil

    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    print(f"=== System Status Report ===")
    print(f"CPU Usage: {cpu_percent}%")
    print(f"Memory Usage: {memory.percent}%")
    print(f"Disk Usage: {disk.percent}%")
    print(f"Task: {task_name} (ID: {task_id})")


def backup_logs(task_id, task_name):
    """Demo task: Backup log files"""
    import os
    import shutil
    from datetime import datetime, timezone

    log_dir = "/var/log"
    backup_dir = f"/tmp/log_backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    if os.path.exists(log_dir):
        print(f"Backing up logs from {log_dir} to {backup_dir}")
    else:
        print(f"Log directory {log_dir} does not exist")


def cleanup_temp_files(task_id, task_name):
    """Demo task: Clean up temporary files"""
    import os
    import glob

    temp_dirs = ['/tmp', '/var/tmp']
    cleaned = 0

    for temp_dir in temp_dirs:
        if os.path.exists(temp_dir):
            for f in glob.glob(os.path.join(temp_dir, '*.tmp')):
                try:
                    os.remove(f)
                    cleaned += 1
                except Exception as e:
                    print(f"Failed to remove {f}: {e}")

    print(f"Cleaned up {cleaned} temporary files. Task: {task_name} (ID: {task_id})")


def send_heartbeat(task_id, task_name):
    """Demo task: Send heartbeat signal"""
    print(f"Heartbeat from task '{task_name}' (ID: {task_id}) at UTC {__import__('datetime').datetime.now(timezone=__import__('datetime').timezone.utc).isoformat()}")


def write_log_to_path(task_id, task_name):
    """Write log to /vol1/1000/我的程序/task_log/task.log"""
    import os
    from datetime import datetime, timezone

    log_file = "/vol1/1000/我的程序/task_log/task.log"
    log_dir = os.path.dirname(log_file)

    os.makedirs(log_dir, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"{timestamp} - Task '{task_name}' (ID: {task_id}) executed successfully\n"

    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(log_line)

    print(f"Log written to {log_file}: {log_line.strip()}")


def simple_log(task_id, task_name):
    """Simple log to /vol1/1000/我的程序/task_execution.log"""
    import os
    from datetime import datetime

    log_dir = "/vol1/1000/我的程序"
    log_file = os.path.join(log_dir, "task_execution.log")

    os.makedirs(log_dir, exist_ok=True)

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"[{timestamp}] Task '{task_name}' (ID: {task_id}) executed successfully\n"

    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(log_line)

    print(log_line.strip())


if __name__ == "__main__":
    print("This module contains built-in task functions.")
    print("Add your custom functions below.")
