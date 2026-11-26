# Planificateur de base

Planificateur de base interactif (Next.js + TypeScript, export statique), pensé pour GitHub Pages.

## Lancer en local
```
npm install
npm run dev
```

## Publier sur GitHub Pages
1. Envoie ce projet sur un dépôt GitHub (branche `main`).
2. **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Chaque push sur `main` reconstruit et publie le site (`.github/workflows/deploy.yml`).

## Ajouter tes images
Mets-les dans `public/assets/`, puis renseigne `image: '/assets/mon-objet.png'` dans `CATALOG` (`src/lib/plan.ts`). Sans image, l'objet est dessiné en aplat de couleur avec une icône.

## Structure
- `src/lib/plan.ts` : modèle de données, catalogue, géométrie (lignes, rectangles, remplissage, murs).
- `src/components/Planner.tsx` : interface et dessin sur canvas.
