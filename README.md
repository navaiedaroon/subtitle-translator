cat > README.md << 'EOF'
# 🎬 Subtitle Translator (English → Persian)

A Windows automation tool that batch-translates English subtitle files to Persian
using [tools.newzone.top](https://tools.newzone.top/en/subtitle-translator)
via a real Chrome browser controlled by Playwright.

---

## ✨ Features

- 🚀 **Batch processing** — translates every subtitle file in `sub_en/`
- 🎯 **Persian output** — saves translated files into `sub_fa/`
- 🔒 **Persistent Chrome profile** — your settings (language, API) are remembered
- ⚡ **Silent download** — no "Save as" dialog (uses Chrome DevTools Protocol)
- 🔁 **Auto-skip** — files already translated are skipped automatically
- 🧹 **Auto reset** — clicks "Clear all" between files
- 📁 **Preserves extension** — `1.vtt` → `1_fa.vtt`, `movie.srt` → `movie_fa.srt`
- 🛡️ **Robust selectors** — multiple strategies to find UI elements
- 📸 **Error screenshots** — saves a screenshot when something fails

---

## 📋 Requirements

| Software | Version | Download |
|----------|---------|----------|
| **Windows** | 10 or 11 | — |
| **Node.js** | 18 or higher | [nodejs.org](https://nodejs.org) |
| **Google Chrome** | Any recent version | [google.com/chrome](https://www.google.com/chrome/) |
| **Git** (optional) | Any | [git-scm.com](https://git-scm.com) |

> ⚠️ **Do NOT run** `npx playwright install chromium` — the script uses your
> existing Chrome installation.

---

## 📦 Installation

### 1. Clone the repository

```bash
git clone https://github.com/navaiedaroon/subtitle-translator.git
cd subtitle-translator
