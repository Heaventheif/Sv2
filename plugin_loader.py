"""
plugin_loader.py
- يكتشف كل ملفات plugins/ تلقائياً
- يثبت متطلبات كل plugin من plugins/requirements/<name>.txt
- يسجل routes كل plugin على FastAPI app
- يحدّث Dockerfile و requirements.txt الجذر تلقائياً
"""

import os
import sys
import glob
import subprocess
import importlib
import importlib.util
import logging

logger = logging.getLogger("plugin_loader")

PLUGINS_DIR      = os.path.join(os.path.dirname(__file__), "plugins")
REQ_DIR          = os.path.join(PLUGINS_DIR, "requirements")
ROOT_REQ_FILE    = os.path.join(os.path.dirname(__file__), "requirements.txt")
DOCKERFILE_PATH  = os.path.join(os.path.dirname(__file__), "Dockerfile")

# سجل الـ plugins المحمَّلة — يُعرض في /
_registry: dict = {}


def get_registry() -> dict:
    return _registry


# ═══════════════════════════════════════════════════
# تثبيت المتطلبات
# ═══════════════════════════════════════════════════

def _install_requirements(plugin_name: str) -> bool:
    """يثبت متطلبات plugin معين إن وُجد ملف requirements له."""
    req_file = os.path.join(REQ_DIR, f"{plugin_name}.txt")
    if not os.path.exists(req_file):
        return True  # لا متطلبات خاصة — OK

    logger.info(f"[{plugin_name}] تثبيت المتطلبات من {req_file}")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install",
             "-r", req_file, "--quiet", "--break-system-packages"],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            logger.error(f"[{plugin_name}] فشل التثبيت:\n{result.stderr[:500]}")
            return False
        logger.info(f"[{plugin_name}] ✅ تم تثبيت المتطلبات")
        return True
    except subprocess.TimeoutExpired:
        logger.error(f"[{plugin_name}] ⏱ انتهت مهلة تثبيت المتطلبات")
        return False
    except Exception as e:
        logger.error(f"[{plugin_name}] خطأ: {e}")
        return False


# ═══════════════════════════════════════════════════
# تحديث requirements.txt الجذر
# ═══════════════════════════════════════════════════

def _sync_root_requirements():
    """
    يجمع كل ملفات plugins/requirements/*.txt
    ويضيف أي مكتبة غير موجودة في requirements.txt الجذر.
    """
    if not os.path.exists(REQ_DIR):
        return

    # اقرأ المتطلبات الحالية
    existing = set()
    if os.path.exists(ROOT_REQ_FILE):
        with open(ROOT_REQ_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    # أزل version specifier للمقارنة
                    pkg = line.split("==")[0].split(">=")[0].split("<=")[0].strip().lower()
                    existing.add(pkg)

    new_lines = []
    for req_file in sorted(glob.glob(os.path.join(REQ_DIR, "*.txt"))):
        plugin_name = os.path.basename(req_file)[:-4]
        with open(req_file) as f:
            pkgs = [l.strip() for l in f if l.strip() and not l.startswith("#")]
        added = []
        for pkg in pkgs:
            pkg_name = pkg.split("==")[0].split(">=")[0].split("<=")[0].strip().lower()
            if pkg_name not in existing:
                new_lines.append(pkg)
                existing.add(pkg_name)
                added.append(pkg)
        if added:
            logger.info(f"[sync] إضافة لـ requirements.txt: {added} (من {plugin_name})")

    if new_lines:
        with open(ROOT_REQ_FILE, "a") as f:
            f.write(f"\n# ─── auto-added by plugin_loader ───────────────────\n")
            f.write("\n".join(new_lines) + "\n")
        logger.info(f"[sync] ✅ تم تحديث requirements.txt بـ {len(new_lines)} مكتبة جديدة")


# ═══════════════════════════════════════════════════
# تحديث Dockerfile
# ═══════════════════════════════════════════════════

def _sync_dockerfile():
    """
    يفحص كل plugin عن apt packages مطلوبة (dockerfile_deps قائمة في الـ plugin)
    ويضيفها لـ Dockerfile إن لم تكن موجودة.

    كل plugin يعلن متطلباته هكذا:
        DOCKERFILE_DEPS = ["ffmpeg", "libsndfile1"]
    """
    if not os.path.exists(DOCKERFILE_PATH):
        return

    with open(DOCKERFILE_PATH) as f:
        dockerfile = f.read()

    # اجمع كل apt deps من جميع plugins
    all_apt = set()
    for filepath in glob.glob(os.path.join(PLUGINS_DIR, "*.py")):
        spec = importlib.util.spec_from_file_location("_tmp", filepath)
        mod  = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            deps = getattr(mod, "DOCKERFILE_DEPS", [])
            all_apt.update(deps)
        except Exception:
            pass

    if not all_apt:
        return

    # أيها غير موجود في Dockerfile؟
    missing = [d for d in sorted(all_apt) if d not in dockerfile]
    if not missing:
        return

    # أضفها في كتلة apt-get الموجودة
    insert_after = "apt-get install -y \\\n"
    if insert_after not in dockerfile:
        logger.warning("[dockerfile] لم يُعثر على كتلة apt-get install — تخطي")
        return

    additions = "".join(f"    {pkg} \\\n" for pkg in missing)
    dockerfile = dockerfile.replace(insert_after, insert_after + additions, 1)

    with open(DOCKERFILE_PATH, "w") as f:
        f.write(dockerfile)

    logger.info(f"[dockerfile] ✅ أضيف لـ Dockerfile: {missing}")


# ═══════════════════════════════════════════════════
# تحميل الـ plugins
# ═══════════════════════════════════════════════════

def load_all_plugins(app):
    """
    نقطة الدخول الرئيسية — يُستدعى مرة واحدة من main.py
    """
    os.makedirs(PLUGINS_DIR,  exist_ok=True)
    os.makedirs(REQ_DIR,      exist_ok=True)

    # تزامن requirements.txt و Dockerfile أولاً
    _sync_root_requirements()
    _sync_dockerfile()

    plugin_files = sorted(glob.glob(os.path.join(PLUGINS_DIR, "*.py")))
    # تجاهل __init__.py و _base.py
    plugin_files = [f for f in plugin_files
                    if not os.path.basename(f).startswith("_")]

    loaded = 0
    for filepath in plugin_files:
        plugin_name = os.path.basename(filepath)[:-3]
        _load_one_plugin(app, plugin_name, filepath)
        loaded += 1

    logger.info(f"[plugin_loader] ✅ تم تحميل {loaded} plugin(s)")


def _load_one_plugin(app, name: str, filepath: str):
    """يحمل plugin واحد — يثبت متطلباته ويسجل routes."""
    try:
        # 1. ثبّت المتطلبات أولاً
        ok = _install_requirements(name)
        if not ok:
            logger.error(f"[{name}] ⛔ تخطي — فشل تثبيت المتطلبات")
            _registry[name] = {"status": "error", "reason": "requirements install failed"}
            return

        # 2. حمّل الـ module
        spec   = importlib.util.spec_from_file_location(f"plugins.{name}", filepath)
        module = importlib.util.module_from_spec(spec)
        sys.modules[f"plugins.{name}"] = module
        spec.loader.exec_module(module)

        # 3. استدعي register(app)
        if not hasattr(module, "register"):
            logger.warning(f"[{name}] ⚠️ لا توجد دالة register() — تخطي")
            return

        routes_before = len(app.routes)
        module.register(app)
        new_routes = len(app.routes) - routes_before

        # 4. سجل في الـ registry
        description = getattr(module, "DESCRIPTION", "")
        _registry[name] = {
            "status":      "loaded",
            "routes_added": new_routes,
            "description": description,
        }
        logger.info(f"[{name}] ✅ محمَّل — {new_routes} route(s) مضافة")

    except Exception as e:
        logger.exception(f"[{name}] ❌ خطأ أثناء التحميل: {e}")
        _registry[name] = {"status": "error", "reason": str(e)}
