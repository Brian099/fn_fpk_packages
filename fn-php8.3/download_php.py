import os
import urllib.request
import re

# 核心组件（在 php8.3 源码包目录下）
CORE_COMPONENTS = [
    "php8.3-fpm", "php8.3-cli", "php8.3-common", "php8.3-opcache", "php8.3-readline",
    "php8.3-mysql", "php8.3-xml", "php8.3-curl", "php8.3-gd", "php8.3-mbstring",
    "php8.3-zip", "php8.3-bcmath", "php8.3-bz2", "php8.3-cgi", "php8.3-intl", 
    "php8.3-ldap", "php8.3-soap", "php8.3-sqlite3", "php8.3-tidy"
]

# 独立扩展（在各自的源码包目录下）
EXT_COMPONENTS = {
    "php8.3-xsl": "php8.3",
    "php8.3-redis": "php-redis",
    "php8.3-memcached": "php-memcached",
    "php8.3-imagick": "php-imagick",
    "php8.3-swoole": "php-swoole",
    "php8.3-igbinary": "php-igbinary",
    "php8.3-msgpack": "php-msgpack",
    "php8.3-xdebug": "../../x/xdebug", # xdebug 在 x/ 目录下
    "php8.3-yaml": "php-yaml",
    "php8.3-apcu": "php-apcu",
    "php8.3-ssh2": "php-ssh2",
}

MIRROR_ROOT = "https://packages.sury.org/php/pool/main/p/"
BASE_DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "app", "target", "packages")
ARCHS = ["amd64", "arm64"]

def get_latest_deb_url(package_name, pool_name, arch):
    base_url = f"{MIRROR_ROOT}{pool_name}/"
    print(f"正在查询 {package_name} ({arch}) 于 {pool_name} ...")
    req = urllib.request.Request(base_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        pattern = fr'href="({package_name}_[0-9\.+-]+(?:~deb12u\d+|\+debian12)[^"]*?(?:{arch}|all)\.deb)"'
        matches = re.findall(pattern, html)
        
        if not matches:
            pattern_fallback = fr'href="({package_name}_[^"]+?debian12[^"]*?_{arch}\.deb)"'
            matches = re.findall(pattern_fallback, html)
            
        if not matches:
            pattern_last_resort = fr'href="({package_name}_[^"]+?_{arch}\.deb)"'
            matches = re.findall(pattern_last_resort, html)

        if not matches:
            print(f"  [失败] 未能找到 {package_name} ({arch})")
            return None
            
        latest_file = sorted(matches)[-1]
        print(f"  [成功] 找到: {latest_file}")
        return base_url + latest_file
    except Exception as e:
        print(f"  [错误] 访问 {base_url} 出错: {e}")
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
    for arch in ARCHS:
        download_dir = os.path.join(BASE_DOWNLOAD_DIR, arch)
        if not os.path.exists(download_dir): os.makedirs(download_dir)
        
        # 核心组件
        for comp in CORE_COMPONENTS:
            url = get_latest_deb_url(comp, "php8.3", arch)
            if url: download_file(url, download_dir)
        
        # 扩展组件
        for comp, pool in EXT_COMPONENTS.items():
            url = get_latest_deb_url(comp, pool, arch)
            if url: download_file(url, download_dir)

    # 清理 packages 根目录下的旧文件
    print("\n正在清理 packages 根目录下的旧离线包...")
    for f in os.listdir(BASE_DOWNLOAD_DIR):
        if f.endswith(".deb"):
            os.remove(os.path.join(BASE_DOWNLOAD_DIR, f))
            print(f"已清理: {f}")

if __name__ == '__main__':
    main()
