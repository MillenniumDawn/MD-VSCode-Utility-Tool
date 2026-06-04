# Project: MD VSCode Utility Tool

## Versie & changelog — verplicht bij elke wijziging

Bij **elke turn waarin bronbestanden gewijzigd worden** (alles behalve `CHANGELOG.md`
en `package.json` zelf) geldt:

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
(+1 patch) en de bijbehorende CHANGELOG-entry **al op als expliciete stap in het plan** —
niet pas als afterthought achteraf. De changelog/commit-stap hoort onderdeel te zijn van
het ontwerp.

### Afdwinging
Een `Stop`-hook ([.claude/hooks/changelog-guard.js](.claude/hooks/changelog-guard.js))
controleert aan het eind van elke turn of bronwijzigingen samengaan met een versie-bump én
een changelog-update, en blokkeert het afronden tot beide gedaan zijn. De hook is het
vangnet; de regels hierboven zijn leidend voor de inhoud.
