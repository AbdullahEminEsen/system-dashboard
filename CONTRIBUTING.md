# Contributing to System Dashboard

Thank you for taking the time to contribute! The following guidelines will help you contribute effectively and make the process smooth for everyone.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Submitting a Pull Request](#submitting-a-pull-request)
- [Development Setup](#development-setup)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Project Structure](#project-structure)
- [Platform Notes](#platform-notes)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report any unacceptable behavior to [@AbdullahEminEsen](https://github.com/AbdullahEminEsen).

---

## How Can I Contribute?

### Reporting Bugs

Before submitting a bug report, please check existing [issues](https://github.com/AbdullahEminEsen/system-dashboard/issues) to avoid duplicates.

When reporting a bug, please include:

- **Operating system** and version (Windows 11, macOS 14, Ubuntu 22.04, etc.)
- **Node.js version** (`node --version`)
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Screenshots** if applicable

> Open a new issue using the **Bug report** label.

### Suggesting Features

Have an idea for a new card, setting, or improvement? We'd love to hear it!

When suggesting a feature, please explain:

- **What** the feature does
- **Why** it would be useful
- **How** it might work (optional)

> Open a new issue using the **enhancement** label.

### Submitting a Pull Request

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Make your changes** and test them on your platform
4. **Commit** your changes following the [commit guidelines](#commit-message-guidelines)
5. **Push** your branch:
   ```bash
   git push origin feat/your-feature-name
   ```
6. **Open a Pull Request** against the `main` branch and describe what you changed and why

> For large changes, please open an issue first to discuss your approach before submitting a PR.

---

## Development Setup

### Requirements

- [Node.js](https://nodejs.org) (LTS)
- [Git](https://git-scm.com)

### Steps

```bash
# Clone the repository
git clone https://github.com/AbdullahEminEsen/system-dashboard.git
cd system-dashboard

# Install dependencies
npm install

# Start the app
npm start

# Build installer
npm run build
```

---

## Commit Message Guidelines

Use the following format for commit messages:

```
type: short description
```

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `refactor` | Code refactoring (no feature/bug change) |
| `perf` | Performance improvements |
| `ci` | CI/CD changes |

**Examples:**
```
feat: add battery status card
fix: GPU temperature not showing on NVIDIA
docs: update README with new screenshots
```

---

## Project Structure

```
src/
├── main.js          # Electron main process — system data, IPC handlers, windows
├── renderer.js      # Main widget UI and logic
├── editor.js        # Card editor window logic
├── settings.js      # Settings window logic
├── benchmark.js     # Stress benchmark logic
├── i18n.js          # Translations (Turkish / English)
├── index.html       # Main widget window
├── editor.html      # Card editor window
├── settings.html    # Settings window
└── benchmark.html   # Benchmark window
```

---

## Platform Notes

| Feature | Windows | macOS | Linux |
|---|---|---|---|
| CPU & RAM | ✅ | ✅ | ✅ |
| GPU (NVIDIA) | ✅ Full support | ✅ Full support | ✅ Full support |
| GPU (AMD) | ⚠️ Model info only | ⚠️ Model info only | ⚠️ Model info only |
| CPU Temperature | ✅ (run as admin) | ✅ | ⚠️ Varies by distro |
| Transparency | ✅ | ✅ | ⚠️ X11 only |
| Always on top | ✅ | ✅ | ✅ |
| System tray | ✅ | ✅ | ✅ |

---

## Questions?

Feel free to open an issue or reach out via GitHub: [@AbdullahEminEsen](https://github.com/AbdullahEminEsen)
