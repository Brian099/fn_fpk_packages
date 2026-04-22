import os
import urllib.request
import re

# 基础 PHP 8.2 核心组件和官方扩展库 (来自 php8.2 源码包)
COMPONENTS_PHP82 = [
    "php8.2-fpm", "php8.2-cli", "php8.2-common", "php8.2-opcache", "php8.2-readline",
    "php8.2-mysql", "php8.2-xml", "php8.2-curl", "php8.2-gd", "php8.2-mbstring",
    "php8.2-zip", "php8.2-bcmath", "php8.2-bz2", "php8.2-cgi", "php8.2-dba",
    "php8.2-enchant", "php8.2-gmp", "php8.2-interbase", "php8.2-intl", "php8.2-ldap",
    "php8.2-odbc", "php8.2-pgsql", "php8.2-pspell", "php8.2-snmp", "php8.2-soap",
    "php8.2-sqlite3", "php8.2-sybase", "php8.2-tidy", "php8.2-xmlrpc", "php8.2-xsl",
    "php8.2-dev", "php8.2-imap"
]

# 常见的 PECL 独立扩展组件 (比如 redis, swoole 等)
COMPONENTS_PECL = {
    "php-redis": "php-redis",
    "php-memcached": "php-memcached",
    "php-imagick": "php-imagick",
    "php-swoole": "php-swoole",
    "php-igbinary": "php-igbinary",
    "php-msgpack": "php-msgpack",
    "php-xdebug": "php-xdebug",
    "php-yaml": "php-yaml",
    "php-apcu": "php-apcu",
    "php-ssh2": "php-ssh2",
}

MIRROR_BASE = "https://mirrors.aliyun.com/debian/pool/main/p/"
BASE_DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "app", "target", "packages")
ARCHS = ["amd64", "arm64"]

def get_latest_deb_url(base_url, package_name, arch):
    print(f"正在从镜像站查询 {package_name} ({arch}) ...")
    req = urllib.request.Request(base_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        pattern = fr'href="({package_name}_[^"]+?(?:{arch}|all)\.deb)"'
        matches = re.findall(pattern, html)
        
        if not matches:
            print(f"  [失败] 未能找到 {package_name} ({arch}) 的安装包")
            return None
            
        latest_file = sorted(matches)[-1]
        print(f"  [成功] 找到: {latest_file}")
        return base_url + latest_file
    except Exception as e:
        print(f"  [错误] 访问镜像站出错: {e}")
        return None

def download_file(url, out_dir):
    if not url: return None
    filename = url.split('/')[-1]
    filepath = os.path.join(out_dir, filename)
    
    if os.path.exists(filepath):
        print(f"跳过下载，本地已存在: {filename}")
        return filepath
        
    print(f"正在下载: {filename} ...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response, open(filepath, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
        print(f"下载完毕: {filename} (大小: {os.path.getsize(filepath)/1024/1024:.2f} MB)")
        return filepath
    except Exception as e:
        print(f"下载文件失败: {e}")
        return None

def main():
    for arch in ARCHS:
        download_dir = os.path.join(BASE_DOWNLOAD_DIR, arch)
        if not os.path.exists(download_dir):
            os.makedirs(download_dir)
            print(f"创建离线包存放目录: {download_dir}")

        urls_to_download = []

        # 1. 查询 PHP 8.2 系统内建组件
        base_php82 = MIRROR_BASE + "php8.2/"
        for comp in COMPONENTS_PHP82:
            url = get_latest_deb_url(base_php82, comp, arch)
            urls_to_download.append(url)

        # 2. 查询独立 PECL 扩展
        for comp, folder in COMPONENTS_PECL.items():
            base_pecl = MIRROR_BASE + folder + "/"
            url = get_latest_deb_url(base_pecl, comp, arch)
            urls_to_download.append(url)

        print(f"\n--- 开始下载 {arch} 离线安装包 (共匹配 {len([u for u in urls_to_download if u])} 个文件) ---")
        total_size = 0
        success_count = 0
        
        for url in urls_to_download:
            if url:
                path = download_file(url, download_dir)
                if path and os.path.exists(path):
                    total_size += os.path.getsize(path)
                    success_count += 1

        print(f"\n--- {arch} 下载统计 ---")
        print(f"成功下载数量: {success_count} 个架构包")
        print(f"总计离线包大小: {total_size / 1024 / 1024:.2f} MB")
        print(f"所有包存放路径: {os.path.abspath(download_dir)}")

    # 清理 packages 根目录下的旧文件
    print("\n正在清理 packages 根目录下的旧离线包...")
    for f in os.listdir(BASE_DOWNLOAD_DIR):
        if f.endswith(".deb"):
            os.remove(os.path.join(BASE_DOWNLOAD_DIR, f))
            print(f"已清理: {f}")

    print("\n下载完成即可用于本地 FPK 内置离线合并。")

if __name__ == '__main__':
    main()
