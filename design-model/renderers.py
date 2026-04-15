#!/usr/bin/env python3
"""
Multi-Language Renderer System

Each renderer takes code + an output path and produces a screenshot.
The self-training loop rotates through languages so the model learns
to evaluate design across HTML, SwiftUI, React, Python GUIs, etc.

Currently supported:
  - html     : Vanilla HTML/CSS/JS via Puppeteer
  - swiftui  : SwiftUI native Mac app via swiftc + screencapture
  - react    : React component via Vite + Puppeteer
  - python   : Python Tkinter/PyQt GUI via subprocess + screencapture

Each renderer returns: (success: bool, screenshot_path: str | None, error: str | None)
"""

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable


# ═══════════════════════════════════════════════════
# HTML RENDERER (Puppeteer)
# ═══════════════════════════════════════════════════

def render_html(code: str, output_path: str, viewport=(1440, 900)) -> tuple[bool, str | None, str | None]:
    """Render HTML to PNG via Puppeteer."""
    html_path = output_path.replace('.png', '.html')
    Path(html_path).write_text(code)

    w, h = viewport
    script = f"""
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({{headless:true,args:['--no-sandbox']}});
const p = await b.newPage();
await p.setViewport({{width:{w},height:{h},deviceScaleFactor:2}});
await p.goto('file://{html_path}',{{waitUntil:'networkidle0',timeout:15000}});
await new Promise(r=>setTimeout(r,800));
await p.screenshot({{path:'{output_path}',type:'png'}});
await b.close();
"""
    try:
        result = subprocess.run(
            ["node", "-e", script],
            cwd=str(Path(__file__).parent.parent),
            capture_output=True, timeout=30, text=True,
        )
        if os.path.exists(output_path):
            return True, output_path, None
        return False, None, result.stderr[:200]
    except Exception as e:
        return False, None, str(e)[:200]


# ═══════════════════════════════════════════════════
# SWIFTUI RENDERER (swiftc + screencapture)
# ═══════════════════════════════════════════════════

SWIFTUI_WRAPPER = """
import SwiftUI
import AppKit

{user_code}

// Bootstrap: launch, render, screenshot via NSView layer, quit
@main
struct DesignApp: App {{
    var body: some Scene {{
        WindowGroup {{
            ContentView()
                .frame(width: {width}, height: {height})
                .onAppear {{
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {{
                        captureAndExit()
                    }}
                }}
        }}
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
    }}
}}

func captureAndExit() {{
    guard let window = NSApp.windows.first(where: {{ $0.isVisible }}) else {{
        NSApp.terminate(nil)
        return
    }}

    // Use NSView's bitmap representation — works on all macOS versions
    guard let contentView = window.contentView else {{
        NSApp.terminate(nil)
        return
    }}

    let bounds = contentView.bounds
    guard let rep = contentView.bitmapImageRepForCachingDisplay(in: bounds) else {{
        NSApp.terminate(nil)
        return
    }}

    contentView.cacheDisplay(in: bounds, to: rep)

    if let data = rep.representation(using: .png, properties: [:]) {{
        try? data.write(to: URL(fileURLWithPath: "{output_path}"))
    }}
    NSApp.terminate(nil)
}}
"""


def render_swiftui(code: str, output_path: str, viewport=(1440, 900)) -> tuple[bool, str | None, str | None]:
    """Compile and run a SwiftUI app, then screenshot its window."""
    w, h = viewport

    # Extract just the ContentView and supporting types — strip any app boilerplate
    # The user code should define `struct ContentView: View { ... }` and maybe other types
    user_code = code

    # If the user code already has @main, strip it (we provide our own bootstrap)
    user_code = re.sub(r'@main\s+struct\s+\w+\s*:\s*App\s*\{[\s\S]*?^\}', '', user_code, flags=re.MULTILINE)
    # Also strip any existing App struct
    user_code = re.sub(r'struct\s+\w+\s*:\s*App\s*\{[\s\S]*?^\}', '', user_code, flags=re.MULTILINE)

    full_source = SWIFTUI_WRAPPER.format(
        user_code=user_code,
        width=w,
        height=h,
        output_path=output_path,
    )

    with tempfile.NamedTemporaryFile(mode='w', suffix='.swift', delete=False) as f:
        f.write(full_source)
        swift_file = f.name

    binary_path = swift_file.replace('.swift', '')

    try:
        # Compile
        compile_result = subprocess.run(
            ["swiftc", "-parse-as-library", "-o", binary_path, swift_file],
            capture_output=True, text=True, timeout=60,
        )
        if compile_result.returncode != 0:
            # Hoist the error cap so the next iteration's LLM prompt sees
            # all compile errors, not just the first. 900 chars ≈ 4-6
            # swiftc error lines with context, which is what fix-on-next-
            # iteration needs.
            return False, None, f"Compile: {compile_result.stderr[:900]}"

        # Run the app (it will self-quit after screenshot)
        run_result = subprocess.run(
            [binary_path],
            capture_output=True, text=True, timeout=15,
        )

        if os.path.exists(output_path):
            return True, output_path, None
        return False, None, f"Run: {run_result.stderr[:600] or 'no screenshot produced'}"

    except subprocess.TimeoutExpired:
        return False, None, "Swift app timeout"
    except Exception as e:
        return False, None, str(e)[:200]
    finally:
        try: os.unlink(swift_file)
        except: pass
        try: os.unlink(binary_path)
        except: pass


# ═══════════════════════════════════════════════════
# REACT RENDERER (inline JSX → HTML via Babel standalone)
# ═══════════════════════════════════════════════════

REACT_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }}
#root {{ width: 100vw; min-height: 100vh; }}
{extra_css}
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
{user_code}

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
// Try to find the main component — user should export default or define App
if (typeof App !== 'undefined') {{
  root.render(React.createElement(App));
}} else {{
  root.render(React.createElement('div', {{style: {{padding: 20}}}}, 'No App component found'));
}}
</script>
</body>
</html>
"""


def render_react(code: str, output_path: str, viewport=(1440, 900)) -> tuple[bool, str | None, str | None]:
    """Render a React component via Babel standalone + Puppeteer."""
    # Extract CSS if it's in a separate <style> block within the code
    css_match = re.search(r'<style>([\s\S]*?)</style>', code)
    extra_css = css_match.group(1) if css_match else ""
    user_code = re.sub(r'<style>[\s\S]*?</style>', '', code)

    # Strip any HTML wrappers the model might have added
    user_code = re.sub(r'<!DOCTYPE[\s\S]*?<body>', '', user_code)
    user_code = re.sub(r'</body>[\s\S]*?</html>', '', user_code)

    html = REACT_TEMPLATE.format(user_code=user_code, extra_css=extra_css)
    return render_html(html, output_path, viewport)


# ═══════════════════════════════════════════════════
# PYTHON GUI RENDERER (Tkinter/PyQt via subprocess + screencapture)
# ═══════════════════════════════════════════════════

PYTHON_GUI_WRAPPER = """
import sys
import subprocess
import threading
import time
{user_code}

def _capture_and_exit():
    time.sleep(1.2)  # Let the GUI render
    subprocess.run(['screencapture', '-o', '-w', '{output_path}'], timeout=5)
    import os
    os._exit(0)

threading.Thread(target=_capture_and_exit, daemon=True).start()

# Run the main GUI entry point (the user's code should call this)
if __name__ == '__main__':
    if 'main' in dir():
        main()
    elif 'App' in dir():
        App().mainloop() if hasattr(App(), 'mainloop') else App().run()
"""


def render_python(code: str, output_path: str, viewport=(1440, 900)) -> tuple[bool, str | None, str | None]:
    """Run a Python GUI script, screenshot it, quit."""
    # Python GUI screenshots are tricky — screencapture -w requires user interaction
    # Simpler approach: use Tkinter's built-in PostScript export if available,
    # or let the app save its own screenshot via PIL/ImageGrab
    return False, None, "Python GUI rendering not yet implemented (requires PIL.ImageGrab or GUI-specific export)"


# ═══════════════════════════════════════════════════
# DISPATCH
# ═══════════════════════════════════════════════════

RENDERERS: dict[str, Callable] = {
    "html": render_html,
    "swiftui": render_swiftui,
    "react": render_react,
    "python": render_python,
}


def render(language: str, code: str, output_path: str, viewport=(1440, 900)) -> tuple[bool, str | None, str | None]:
    """Render code in the given language to a screenshot."""
    renderer = RENDERERS.get(language)
    if not renderer:
        return False, None, f"Unknown language: {language}"
    return renderer(code, output_path, viewport)


# ═══════════════════════════════════════════════════
# TEST
# ═══════════════════════════════════════════════════

if __name__ == "__main__":
    # Test HTML
    print("Testing HTML renderer...")
    html = """<!DOCTYPE html>
<html><body style="background:#0a0a0a;color:#e5e5e5;font-family:-apple-system;padding:40px">
<h1>Test</h1><p>HTML renderer working</p>
</body></html>"""
    ok, path, err = render("html", html, "/tmp/test-html.png")
    print(f"  {'✅' if ok else '❌'} {path or err}")

    # Test SwiftUI
    print("Testing SwiftUI renderer...")
    swift = """
struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                Text("Test")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundColor(.white)
                Text("SwiftUI renderer working")
                    .font(.system(size: 16))
                    .foregroundColor(.gray)
            }
        }
    }
}
"""
    ok, path, err = render("swiftui", swift, "/tmp/test-swiftui.png")
    print(f"  {'✅' if ok else '❌'} {path or err}")

    # Test React
    print("Testing React renderer...")
    react = """
function App() {
  return React.createElement('div',
    {style: {background: '#0a0a0a', color: '#e5e5e5', padding: 40, minHeight: '100vh', fontFamily: '-apple-system'}},
    React.createElement('h1', null, 'Test'),
    React.createElement('p', null, 'React renderer working')
  );
}
"""
    ok, path, err = render("react", react, "/tmp/test-react.png")
    print(f"  {'✅' if ok else '❌'} {path or err}")
