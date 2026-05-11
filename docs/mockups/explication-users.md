# Nouveau flow découpe & vente — votre avis ?

## Le problème qu'on essaie de régler

Aujourd'hui, quand on achète une carcasse de boeuf, ce qu'on met en stock ne porte pas le même nom que ce qu'on vend en caisse. Dans l'ancienne app, ce mapping (par exemple « Boeuf » dans le stock = « Boeuf détails » + « Boeuf gros » à la vente) était caché dans le code. Ça marchait, mais :

- On ne pouvait pas voir les pertes à la découpe (combien d'os, combien de gras ?).
- On ne pouvait pas comparer les rendements d'un boucher à l'autre, d'un mois à l'autre.
- La viande hachée était bricolée avec deux mouvements indépendants (un « sort 7 kg de boeuf », un « rentre 6 kg de hachée »), sans lien.

Le nouveau modèle rend ces opérations **visibles, traçables, et avec des chiffres exploitables**.

---

## La journée type, en 4 moments

1. **Le matin — Réception fournisseur**
   Le responsable note l'arrivée d'une carcasse, par exemple 120 kg de Boeuf. *(Écran existant, pas de changement.)*

2. **Matin/journée — Découpe**
   Le boucher découpe la carcasse. Une seule opération à saisir : il indique combien sort en Boeuf, en Filet, en Faux-filet, en Jarret. L'application calcule automatiquement la chute (os, gras, perte). *(Nouveau.)*

3. **Journée — Ventes en caisse**
   Au moment de vendre du Boeuf à un client, le caissier choisit s'il applique le **tarif détails** ou le **tarif gros**. Le produit en stock est le même, c'est juste le prix qui change. *(Évolution de la caisse actuelle.)*

4. **Le soir — Comptage**
   Le boucher pèse ce qui reste de chaque produit (Boeuf, Filet, Jarret…) et saisit dans la grille du soir. *(Écran déjà en place.)*

---

## Écran 1 — La liste des découpes du jour

Une page qui montre, pour un point de vente et une date :

- **En haut** : 4 chiffres clés (nombre de découpes faites, kg en entrée, kg sorti en produits finis, **kg de chute totale en %**).
- **Au milieu** : un bouton orange « + Nouvelle découpe » pour saisir une nouvelle opération.
- **En bas** : la liste des découpes faites aujourd'hui, avec pour chacune :
  - L'heure et qui l'a faite
  - Le produit source et la quantité de départ
  - La liste de ce qui en est sorti (ex : 70 kg Boeuf, 2,5 kg Filet, 6,5 kg Jarret)
  - La chute en kg et en %
  - Un badge **vert si le rendement est dans la norme**, **rouge si la chute est anormalement forte**

C'est l'écran de pilotage : en un coup d'œil vous voyez si la journée se passe bien.

---

## Écran 2 — Saisir une nouvelle découpe

Un panneau qui s'ouvre sur le côté de l'écran (on ne perd pas le contexte).

**En haut**, le **produit source** : on choisit ce qu'on découpe (Carcasse boeuf, Demi-carcasse, etc.) et la quantité de départ. L'application affiche le stock disponible à côté.

**Au milieu**, une suggestion automatique : « Recette standard : 58 % Boeuf, 2 % Filet, 5 % Jarret… ». Un clic sur **Pré-remplir** remplit le formulaire avec ces valeurs. Ça fait gagner du temps mais ce n'est pas obligatoire — vous gardez la main.

**En bas**, la liste des **sorties**. On ajoute une ligne par produit fini :
- Quel produit (Boeuf, Filet, Faux-filet, Jarret, Viande hachée…)
- Combien de kg
- Le pourcentage par rapport à la source, affiché en direct

Et un **bilan en bas** qui se met à jour en temps réel quand vous tapez :
- Source : 120 kg
- Total sorties : 81 kg
- **Chute : 39 kg, soit 32,5 %**

Si la chute dépasse ce qui est attendu (par exemple 20 %), un message d'alerte apparaît pour vous demander de vérifier ou d'écrire une note explicative.

Un bouton **Enregistrer la découpe** valide tout en une fois.

---

## Écran 3 — Caisse avec choix « détails » ou « gros »

À gauche, la grille des produits comme aujourd'hui. **Trois produits sont mis en avant avec un encadré et un badge « 2 tarifs »** : Boeuf, Veau, Mouton. Ce sont eux qui ont deux prix possibles selon comment ils sont vendus.

À droite, le panier. Pour chaque ligne d'un produit à 2 tarifs, **un petit bouton à 2 positions** apparaît :
- **Détails** (sélectionné par défaut, exemple Boeuf à 3 500 XOF/kg)
- **Gros** (l'autre tarif, exemple Boeuf à 4 200 XOF/kg)

Le caissier clique sur l'une ou l'autre selon ce que le client demande. **Le produit en stock reste le même** (Boeuf), c'est juste le prix unitaire qui change. Le total du panier se met à jour immédiatement.

Pour les produits sans cette option (Filet, Jarret, Viande hachée…), pas de bouton — un seul prix possible, ligne classique.

Avantage : à la fin du mois, on peut dire « ce mois-ci on a vendu 280 kg de Boeuf, dont 60 % en détails et 40 % en gros ». C'est une stat qu'on n'a pas aujourd'hui.

---

## Bonus — Stat rendement sur 30 jours

Une page qui ressort gratuitement de tout ce qui précède. Pour chaque produit source (Carcasse boeuf, Demi-carcasse, Viande boeuf transformée en hachée…), on voit :

- Combien de découpes ont été faites
- Le total kg en entrée et en sortie
- **Le rendement moyen** comparé à ce qui est attendu
- Les 3 produits qui sortent le plus

Idée : si un boucher fait 78 % de rendement alors que la norme est 82 %, on peut en discuter avec lui sur du concret.

---

## Décomposition de la perte — ce qu'on ne voyait pas avant

C'est probablement le point qui va le plus vous parler. Aujourd'hui on calcule la perte avec :

> **perte = stock matin + transferts in − transferts out − stock soir**

Le souci, c'est que ce chiffre mélange **trois choses très différentes** :

1. **La chute de découpe** (os, gras, parage) — c'est normal, c'est attendu.
2. **L'écart d'inventaire** (vol, casse non saisie, erreur de comptage) — ça, c'est la vraie perte qui pose problème.
3. **Les bricolages de transformation** (la hachée saisie comme un transfert in/out) — la "perte" de 1 kg n'en est pas vraiment une.

Résultat : quand la perte mensuelle affiche 900 kg, on s'inquiète sans savoir où agir. Le nouveau modèle sépare ces trois composantes.

**Exemple sur le Boeuf en mai** :

| Métrique | Valeur | Catégorie |
|---|---|---|
| Chute de découpe | 907 kg (18 %) | Normal — attendu 15–20 % |
| Écart d'inventaire | **−8 kg** | À investiguer |

Sur les 915 kg qui s'affichaient avant comme "perte totale", **99 % était de la chute normale** (os et gras). La vraie perte à regarder, c'est les 8 kg manquants à l'inventaire.

Sur l'écran de synthèse mensuelle :
- Une **colonne "chute"** en gris (normal, attendu, juste informatif)
- Une **colonne "écart inventaire"** en rouge si négatif (le seul chiffre qui doit déclencher une enquête)
- Un badge **"à investiguer"** uniquement sur les lignes qui ont un écart inventaire anormal

Plus de panique sur les gros chiffres mélangés. On regarde seulement la VRAIE perte non expliquée.

---

## Ce qui change vraiment pour vous

- **Plus de double saisie pour la viande hachée**. Une seule action de découpe « 7 kg Boeuf → 6 kg Hachée », le système gère le reste.
- **Vous voyez les pertes**. C'est un chiffre qui apparaît à l'écran à chaque découpe et dans les stats du mois.
- **Pas de mapping caché**. Ce qui est en stock porte son vrai nom. Ce qui est vendu porte son vrai nom. Plus de surprise quand on compare.
- **Le tarif détails ou gros se choisit en caisse, pas avant**. Vous ne décidez plus à la découpe ce qui va partir en détails — vous attendez de voir ce que les clients demandent.

---

## Vos avis nous intéressent

Cinq questions pour vous, au choix :

1. **Est-ce que ce flow (réception → découpe → ventes → comptage soir) correspond à votre réalité ?** Y a-t-il une étape qu'on a oublié, ou une étape qui ne se passe pas comme ça en pratique ?

2. **Pour le choix détails/gros en caisse**, est-ce que le petit bouton à 2 positions sur la ligne du panier vous convient ? Ou préférez-vous qu'on vous demande dès qu'on clique sur le produit dans la grille ?

3. **Les pourcentages "attendus" de rendement** (genre 80–85 % pour une carcasse de boeuf) : qui doit les définir ? Est-ce que c'est un chiffre national, ou ça varie selon le boucher / la saison / le type de bête ?

4. **Le terme "chute"** — c'est ce que vous utilisez sur le terrain ? Vous diriez plutôt « os », « perte », « rebut », autre chose ?

5. **Pour la viande hachée**, ok de la traiter comme une simple découpe avec rendement (7 kg → 6 kg) ? Ou il y a des cas où vous voulez la gérer différemment (recette avec d'autres ingrédients, mélange avec autre chose) ?

6. **La décomposition de la perte** en deux chiffres (chute découpe vs écart inventaire) — est-ce une distinction qui vous parle ? Y a-t-il un seuil de tolérance habituel pour l'écart inventaire (genre ±2 % du stock, ou en valeur absolue par produit) en dessous duquel ça ne vaut pas le coup d'enquêter ?

Répondez ce que vous voulez, même un mot par question suffit. On veut ajuster avant de coder pour ne pas refaire.

---

**Lien vers le mockup interactif** : (à fournir une fois hébergé) — vous pourrez cliquer sur les boutons, tester les tarifs, voir le calcul live de la chute. C'est juste une maquette, rien n'est sauvegardé.
