# Contributing

Thanks for your interest in Handy Bird! The game is a static site in `web/`, written
in plain JavaScript modules with Phaser and MediaPipe. There is no build step and no
Node.js toolchain.

## Getting started

Follow [Run it locally](../README.md#run-it-locally) in the README. Work on one
branch per change and keep each commit focused on a single topic. Never commit
virtual environments, `.task` models, passwords or tokens.

## Reporting a problem

When opening an issue, please include:

- the mode you were using (webcam or mouse) and the language of the interface;
- your operating system and browser version;
- the steps to reproduce it, what you expected and what happened;
- the full error message from the browser console, if there is one.

Screenshots help, but please avoid images from your webcam. For larger changes, it's
worth discussing the idea in an issue before starting.

## Testing your changes

```bash
python -m pip install -r requirements.txt
python -m playwright install chromium
python -m unittest discover -s tests -v
```

The tests use a simulated camera and don't download the model. With the game open
through `python tools/serve.py`, you can also run them in the browser console:

```javascript
(await import("./js/tests.js")).runTests()
```

Changes to the camera or to gestures also need a real test with a webcam; if that
isn't possible, mention it in the pull request. When changing the interface, check
both Webcam and Mouse modes, on desktop and on a phone, in both languages.

## Conventions

- Control is direct, by hand height, with no gravity or jumping. Please keep it that
  way.
- Drawing and collision of an obstacle must use the same geometry.
- Every interface text goes in `web/js/i18n.js`, in English and Portuguese, with the
  same keys. In the HTML, mark it with `data-i18n` (or `data-i18n-html`,
  `data-i18n-title`, `data-i18n-label`, `data-i18n-alt`).
- Don't add `?v=` to URLs: the cache policy in `web/_headers` already makes browsers
  pick up new files.
- Keep sprite transparency and proportions, and don't change hitboxes by accident.
- Prefer the libraries the project already uses over new dependencies.
- Update both READMEs when commands, controls or rules change.

## Opening a pull request

Explain the problem, the solution and how you tested it. For visual changes, include
a screenshot in Mouse mode (no webcam). Link the related issue, if any, and mention
known limitations or pending checks.

Code submitted in pull requests is licensed under the project's
[MIT license](../LICENSE). Images and other assets are not covered by it: if you
contribute them, confirm that you have permission to use them and state where they
come from.
