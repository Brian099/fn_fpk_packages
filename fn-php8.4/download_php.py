import os
import urllib.request
import re

# 所有的扩展现在都加上 php8.4- 前缀，这样它们会依赖 php8.4-common
COMPONENTS = [
    "php8.4-fpm", "php8.4-cli", "php8.4-common", "php8.4-opcache", "php8.4-readline",
    "php8.4-mysql", "php8.4-xml", "php8.4-curl", "php8.4-gd", "php8.4-mbstring",
    "php8.4-zip", "php8.4-bcmath", "php8.4-bz2", "php8.4-cgi", "php8.4-intl", 
    "php8.4-ldap", "php8.4-soap", "php8.4-sqlite3", "php8.4-tidy", "php8.4-xsl",
    "php8.4-redis", "php8.4-memcached", "php8.4-imagick", "php8.4-swoole", 
    "php8.4-igbinary", "php8.4-msgpack", "php8.4-xdebug", "php8.4-yaml", "php8.4-apcu", "php8.4-ssh2"
]

MIRROR_BASE = "https://packages.sury.org/php/pool/main/p/php8.4/"
DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "app", "target", "packages")

def get_latest_deb_url(package_name):
    print(f"正在查询 {package_name} ...")
    req = urllib.request.Request(MIRROR_BASE, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        # 核心修复：检查是否包含 +debian12 (Debian 12) 或者 deb12u1
        pattern = fr'href="({package_name}_[0-9\.+-]+(?:~deb12u\d+|\+debian12)[^"]*?(?:amd64|all)\.deb)"'
        matches = re.findall(pattern, html)
        
        if not matches:
            pattern_fallback = fr'href="({package_name}_[^"]+?debian12[^"]*?_amd64\.deb)"'
            matches = re.findall(pattern_fallback, html)
            
        if not matches:
            print(f"  [失败] 未能找到适用于 Debian 12 的 {package_name} 包")
            return None
            
        latest_file = sorted(matches)[-1]
        print(f"  [成功] 找到: {latest_file}")
        return MIRROR_BASE + latest_file
    except Exception as e:
        print(f"  [错误] 访问镜像站出错: {e}")
        return None

def download_file(url, out_dir):
    filename = url.split('/')[-1]
    filepath = os.path.join(out_dir, filename)
    if os.path.exists(filepath):
        print(f"跳过已存在: {filename}")
        return
    print(f"正在下载: {filename} ...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as response, open(filepath, 'wb') as out_file:
            out_file.write(response.read())
    except Exception as e:
        print(f"下载失败: {e}")

def main():
    if not os.path.exists(DOWNLOAD_DIR): os.makedirs(DOWNLOAD_DIR)
    # 清理之前残留的故障包 (debian13)
    for f in os.listdir(DOWNLOAD_DIR):
        if 'debian13' in f or 'php-common' in f:
            print(f"清理错误版本的包: {f}")
            os.remove(os.path.join(DOWNLOAD_DIR, f))

    for comp in COMPONENTS:
        url = get_latest_deb_url(comp)
        if url: download_file(url, DOWNLOAD_DIR)

if __name__ == '__main__':
    main()
