import os
import urllib.request
import re

# 核心组件（在 php8.4 源码包目录下）
CORE_COMPONENTS = [
    "php8.4-fpm", "php8.4-cli", "php8.4-common", "php8.4-opcache", "php8.4-readline",
    "php8.4-mysql", "php8.4-xml", "php8.4-curl", "php8.4-gd", "php8.4-mbstring",
    "php8.4-zip", "php8.4-bcmath", "php8.4-bz2", "php8.4-cgi", "php8.4-intl", 
    "php8.4-ldap", "php8.4-soap", "php8.4-sqlite3", "php8.4-tidy"
]

# 独立扩展（在各自的源码包目录下）
# 映射：组件名 -> 源码包名
EXT_COMPONENTS = {
    "php8.4-xsl": "php8.4", # 有些版本 xsl 也在核心包
    "php8.4-redis": "php-redis",
    "php8.4-memcached": "php-memcached",
    "php8.4-imagick": "php-imagick",
    "php8.4-swoole": "php-swoole",
    "php8.4-igbinary": "php-igbinary",
    "php8.4-msgpack": "php-msgpack",
    "php8.4-xdebug": "../../x/xdebug", # xdebug 在 x/ 目录下
    "php8.4-yaml": "php-yaml",
    "php8.4-apcu": "php-apcu",
    "php8.4-ssh2": "php-ssh2",
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
            # 特殊处理：有些包可能没带 debian12 标签但确实在里面
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
            url = get_latest_deb_url(comp, "php8.4", arch)
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
