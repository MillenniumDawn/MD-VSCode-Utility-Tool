# Project: MD VSCode Utility Tool

## Versie & changelog — eenmalig per branch

Versie-bumps gebeuren **eenmalig per feature-branch**, niet bij elke individuele turn.
De `package.json` en `CHANGELOG.md` worden pas bijgewerkt op het moment van merge
(zoals onderdeel van een afsluitende commit, of in een aparte PR die de branch samenvoegt).

Binnen één branch (of meerdere turns op dezelfde feature) blijft de versie dus stabiel.
Pas bij het afronden van de hele feature:

1. **Bump de versie** in [package.json](package.json) `version`-veld met **+1 patch**
   (bijv. `1.1.2` → `1.1.3`).
2. **Voeg bovenaan [CHANGELOG.md](CHANGELOG.md) een nieuwe sectie toe** met exact diezelfde
   versie als kop (`v1.1.3`), in de bestaande stijl:
   - Subsecties `Functionality:` en/of `Bugfixes:`.
   - Bullets met `  - ` (twee spaties indent), zoals bestaande entries.
   - Gebruik een `[ Component ]`-prefix waar passend (`[ Focus Tree ]`, `[ MIO ]`,
     `[ Technology ]`, …).
   - Inhoudelijk en encyclopedisch; beschrijf wat er daadwerkelijk veranderd is.
3. **Houd `package.json` en de CHANGELOG-kop altijd op exact dezelfde versie.**

### In implementatieplannen
Wanneer je een plan maakt dat functionaliteit toevoegt of wijzigt, neem de versie-bump
(+1 patch) en de bijbehorende CHANGELOG-entry **op als expliciete stap in het plan onder
"Finalize / merge"** — niet als afterthought per turn. De changelog-stap hoort bij het
afronden van de feature, niet bij elk tussentijds commit.

### Afdwinging
De `Stop`-hook ([.claude/hooks/changelog-guard.js](.claude/hooks/changelog-guard.js))
is aangepast of uitgeschakeld voor deze werkwijze; houd de regel hierboven aan bij merges.
