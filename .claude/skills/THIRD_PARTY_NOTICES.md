# Third-party notices — Claude Code skills

Las skills de este directorio provienen de un repositorio de terceros. Se instalaron a nivel de proyecto con el CLI oficial `skills` y se versionan sin modificaciones.

| Skill | Ruta en este repo | Ruta en origen |
| --- | --- | --- |
| `emil-design-eng` | `.claude/skills/emil-design-eng/` | `skills/emil-design-eng/` |
| `prototype` | `.claude/skills/prototype/` | `skills/prototype/` |
| `pick-ui-library` | `.claude/skills/pick-ui-library/` | `skills/pick-ui-library/` |

- **Origen:** https://github.com/emilkowalski/skills
- **Commit:** `d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128` (2026-09-24)
- **Instalación:** `npx skills@1.7.0 add emilkowalski/skills --skill emil-design-eng prototype pick-ui-library --agent claude-code --copy -y`
- **Integridad:** hashes en `skills-lock.json` (raíz del repo).

Este aviso vive fuera de las carpetas de cada skill porque `skills add` y `skills update` reemplazan esas carpetas completas.

## MIT License — emilkowalski/skills

```text
MIT License

Copyright (c) 2026 Emil Kowalski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
