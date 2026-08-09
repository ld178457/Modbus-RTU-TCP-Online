from playwright.sync_api import sync_playwright
import time

URL = "https://modbus-rtu-tcp-online.pages.dev/#/tcp"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error","warning") else None)
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    try:
        pg.goto(URL, wait_until="networkidle", timeout=60000)
    except Exception as e:
        print("GOTO ERR:", e)
    time.sleep(2)

    print("=== BUTTONS ===")
    for btn in pg.locator("button").all():
        try:
            t = btn.inner_text().strip()
            if t:
                print("BTN:", repr(t))
        except Exception:
            pass
    print("=== SEGMENTED OPTIONS ===")
    for el in pg.locator(".mode-seg span, .el-segmented__item").all():
        try:
            print("SEG:", repr(el.inner_text().strip()))
        except Exception:
            pass

    for label in ["模拟从站", "模拟"]:
        try:
            pg.click(f"text={label}", timeout=4000)
            print("clicked:", label)
            break
        except Exception:
            pass
    time.sleep(1)

    sent = False
    for label in ["发送", "建立连接", "连接"]:
        try:
            pg.click(f"text={label}", timeout=4000)
            print("clicked action:", label)
            sent = True
            break
        except Exception:
            pass

    time.sleep(3)
    txt = pg.inner_text("body")
    print("=== BODY TEXT (snippet) ===")
    print(txt[:1500])
    for kw in ["tx", "rx", "响应", "报文", "保持寄存器", "从站", "连接成功", "已连接", "成功"]:
        if kw in txt.lower():
            print("FOUND keyword:", kw)
    pg.screenshot(path="F:/cursor/project_learn/modbusonline/_pw_test_after.png", full_page=True)

    print("=== CONSOLE ERRORS ===")
    print("\n".join(errors) if errors else "none")

    b.close()
print("DONE")
