# 🗡️ Crypt Crawler

Action-RPG roguelike 3D en Three.js. Vue isométrique style Hadès / Diablo, donjons procéduraux, combat à l'épée, boss à l'étage 5.

## 🚀 Lancer le projet

Tu as besoin de [Node.js](https://nodejs.org/) (>= 18 recommandé).

```bash
# Installer les dépendances (la première fois seulement)
npm install

# Démarrer le serveur de dev avec hot-reload
npm run dev
```

Ça va ouvrir automatiquement [http://localhost:5173](http://localhost:5173) dans ton navigateur. À chaque sauvegarde d'un fichier, la page se recharge instantanément.

### Construire pour production

```bash
npm run build      # bundle optimisé dans dist/
npm run preview    # tester le build de production
```

## 🎮 Contrôles

| Touche | Action |
|--------|--------|
| `WASD` ou `ZQSD` ou flèches | Se déplacer |
| Souris | Viser |
| Clic gauche | Attaquer à l'épée |
| `Espace` | Dash (esquive avec i-frames) |
| `P` | Pause |

## 📂 Structure du projet

```
crypt-crawler/
├── index.html          ← coquille HTML + overlays UI
├── package.json
├── vite.config.js
├── README.md
└── src/
    ├── main.js         ← point d'entrée, boot, game loop, lifecycle des runs
    ├── style.css       ← tous les styles UI
    │
    ├── constants.js    ← toutes les valeurs numériques (range, cooldowns…)
    ├── state.js        ← l'objet `state` global (mutable, partagé)
    │
    ├── scene.js        ← init Three.js, caméra suivi, screen shake, torches
    ├── input.js        ← clavier + souris, raycast vers le sol
    ├── audio.js        ← SFX synthétisés via Web Audio API
    │
    ├── dungeon.js      ← génération procédurale, mesh, collision, escalier
    ├── player.js       ← le héros : build, déplacement, dash, attaque
    ├── enemies.js      ← slime, gobelin, archer, boss + IA
    ├── pickups.js      ← cœurs/épées/bottes/or + projectiles (flèches)
    ├── combat.js       ← damageEnemy / damagePlayer / morts
    ├── particles.js    ← système de particules
    └── ui.js           ← HUD, écrans menu/game-over/victoire, dégâts flottants
```

## 🛠 Comment itérer

### Ajuster l'équilibrage
Tout est dans `src/constants.js` (range d'attaque, cooldowns) et dans les `stats` de chaque ennemi en haut de `src/enemies.js` (`makeEnemy`).

### Ajouter un nouvel ennemi
1. Ajoute un nouveau bloc `if (type === 'monNouveau')` dans `makeEnemy()` de `enemies.js` (modèle 3D + stats).
2. Ajoute son IA dans `updateEnemies()` (un nouveau `else if (s.type === 'monNouveau')`).
3. Ajoute le type dans le tableau `types` de `spawnEnemiesForFloor()`.

### Ajouter un nouveau pickup
Dans `pickups.js` : ajoute le type dans `makePickup()` puis l'effet dans `applyPickup()`.

### Modifier la génération de donjon
Dans `src/dungeon.js`, fonction `generateDungeon()`. Pour partir sur une autre topologie (BSP, cellular automata), c'est ce fichier qu'il faut réécrire.

### Ajouter de la musique
Récupère un .mp3/.ogg, mets-le dans `public/`, et dans `audio.js` :
```js
const music = new Audio('/musique.ogg');
music.loop = true;
music.volume = 0.3;
// music.play() après le premier clic utilisateur
```

## 💡 Idées pour la suite

- 🎵 Musique d'ambiance qui change selon l'étage
- 👹 Plus d'ennemis (mage, brute lourde, mini-boss intermédiaires)
- ⚒️ Système d'armes interchangeables (arc, dague, bâton)
- ♾️ Mode infini après le boss avec scaling exponentiel
- 💾 Sauvegarde du record entre les sessions (localStorage)
- 📱 Contrôles tactiles pour mobile
- 🎨 Vrais modèles 3D (GLB/GLTF) à la place des primitives

## 📜 Licence

MIT — fais ce que tu veux avec.
