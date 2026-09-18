# Modpack Merger

Web app qui fusionne **plusieurs** modpacks Minecraft en un seul, aligne tous
les mods sur un mod loader et une version communs, remplace ceux qui
n'existent pas de l'autre côté, et estime la RAM à allouer au résultat.

Tout tourne dans le navigateur : **aucun serveur, aucun envoi de fichier**. Tes
modpacks ne quittent jamais ta machine.

## Démarrer en local

```bash
npm install && npm run dev
```

Puis <http://localhost:3000>.

## Où l'héberger

Le site est un export statique. Selon l'endroit où tu le déposes, il dispose
ou non d'une petite couche serveur — et c'est **la seule chose** qui change.

| Hébergement | Gratuit | CurseForge | Téléchargement des jars |
|---|---|---|---|
| **Cloudflare Workers** | oui | automatique | via le relais, tous les CDN |
| **GitHub Pages** | oui | relais externe à déployer | direct, certains CDN bloquent |

### Cloudflare Workers (recommandé)

`wrangler.toml` déclare le dossier `out/` comme fichiers statiques et
`worker/index.js` comme code serveur. Cloudflare sert les fichiers en
priorité ; le Worker ne reçoit que les routes `/api/`, c'est-à-dire les deux
relais.

Depuis le tableau de bord, *Workers & Pages → Create → Import a repository* :

| Réglage | Valeur |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Puis dans *Settings → Variables and Secrets* :

- `CURSEFORGE_API_KEY` — ta clé, en type **Secret** (chiffrée, jamais envoyée
  au navigateur). Le site se déploie très bien sans, CurseForge sera
  simplement inactif.
- `NODE_VERSION` = `22` — sinon Cloudflare utilise un Node trop ancien pour
  Next 15 et le build échoue.
- `ALLOWED_ORIGIN` = l'URL de ton site, si tu ne veux pas que d'autres
  consomment ton quota CurseForge.

En ligne de commande, une fois `wrangler login` fait :

```bash
npm run deploy
```

et `npm run preview` lance le tout en local, Worker compris.

### Hébergement purement statique (GitHub Pages et autres)

`npm run build` produit dans `out/` un site qui se dépose tel quel sur
n'importe quel hébergement statique. Pour un « project site » GitHub Pages,
servi sous `/<nom-du-depot>/`, il faut indiquer le préfixe :

```bash
NEXT_PUBLIC_BASE_PATH=/Modpack-Merger npm run build
```

Aucun workflow n'est fourni : le dépôt vise Cloudflare Workers, et publier
aussi sur Pages ferait cohabiter deux déploiements divergents. Si tu en veux
un, `actions/upload-pages-artifact` puis `actions/deploy-pages` sur le dossier
`out/` suffisent.

Un hébergement statique n'exécute aucun code : **CurseForge y restera
inactif** tant que tu n'auras pas déployé le Worker autonome de `proxy/` et
collé son URL dans les paramètres de l'application.

### Construire à la main

```bash
NEXT_PUBLIC_BASE_PATH=/mon-depot npm run build   # sort dans out/
```

`NEXT_DIST_DIR=.next-autre` permet de construire sans perturber un
`npm run dev` en cours, qui utiliserait sinon le même cache.

## CurseForge : pourquoi un relais

Modrinth ne demande rien : son API est publique et interrogeable depuis un
navigateur.

CurseForge, non. Son API exige une clé secrète et refuse les appels venant
d'une page web. Et **un site statique ne peut pas garder de secret** : une clé
placée dans le code serait lisible par tous les visiteurs. Il faut donc que
quelque chose la détienne côté serveur.

C'est exactement ce que fait `worker/curseforge.js`, déployé avec le site sur
Cloudflare. Si tu héberges ailleurs qu'un service exécutant du code,
`proxy/curseforge-worker.js` est le même relais sous forme de Worker autonome :

```bash
npm install -g wrangler
wrangler login
wrangler deploy proxy/curseforge-worker.js --name curseforge-relay --compatibility-date 2026-01-01
wrangler secret put CURSEFORGE_API_KEY --name curseforge-relay
```

Colle l'URL obtenue dans **Paramètres → Sources de mods**, puis *Tester la
connexion*.

Dans les deux cas le relais ne transmet qu'une liste fermée de routes, filtre
les paramètres de requête et plafonne la taille des corps : ce n'est pas un
proxy ouvert.

La clé s'obtient sur [console.curseforge.com](https://console.curseforge.com/)
(onglet API Keys) ; la validation est manuelle et prend 1 à 3 jours.

**Sans relais, l'app fonctionne**, mais les mods publiés uniquement sur
CurseForge ne sont même pas identifiés : ils apparaissent sous la forme
`Projet CurseForge 272515` et sont comptés comme introuvables.

## Ce que fait l'outil

### Lecture des packs

Trois formats, détectés automatiquement, sans limite de nombre :

| Format | Reconnu par | Mods identifiés par |
|---|---|---|
| Modrinth `.mrpack` | `modrinth.index.json` | URL du CDN Modrinth |
| CurseForge `.zip` | `manifest.json` | numéros projet/fichier (via le relais) |
| Archive brute | présence de `mods/*.jar` | sha1 (Modrinth) et empreinte murmur2 (CurseForge) |

Un pack ne contient pas que des mods : les `resourcepacks/`, `shaderpacks/` et
`datapacks/` déclarés dans un manifeste sont reconnus comme du contenu à part
entière, résolus sur les deux plateformes et replacés dans le bon dossier à
l'export — pas recopiés en vrac.

**Les jars posés dans `mods/` sans figurer au manifeste participent à la
fusion.** Un pack CurseForge ou Modrinth ne liste dans son manifeste que ce qui
vient de la plateforme ; tout le reste — mods absents du catalogue, versions
bricolées, jars récupérés à la main — est simplement déposé dans
`overrides/mods/`. Les traiter comme des fichiers de configuration les ferait
passer à côté du choix de loader, de la déduplication et des mises à jour. Ils
sont donc identifiés par empreinte, comme ceux d'une archive brute.

Rien n'est décompressé pour lire le catalogue d'une archive : sur un pack qui
embarque un monde sauvegardé, ouvrir chaque fichier pour connaître son nom
représente plusieurs centaines de Mo pour rien. Les jars sont ouverts par lots
bornés, puis relâchés.

Pour une archive brute, chaque `.jar` est aussi ouvert pour lire ses
métadonnées internes (`fabric.mod.json`, `quilt.mod.json`,
`META-INF/mods.toml`, `META-INF/neoforge.mods.toml`), ce qui permet
d'identifier même un mod jamais publié.

### Fusion

1. **Ordre de priorité** — tu ranges les packs à l'étape 1. En cas de valeur
   contradictoire, le pack le plus haut l'emporte.
2. **Déduplication** — un mod présent dans plusieurs packs devient une seule
   entrée. La correspondance se fait sur l'identifiant de projet, le hash du
   fichier, le `modId` du jar ou le titre normalisé.
3. **Résolution** — chaque contenu est cherché dans la combinaison loader +
   version demandée, dans sa version **la plus récente parmi les plus
   stables** : une release récente l'emporte sur une beta plus récente. Une
   beta n'est retenue qu'à défaut.

   Quand une version plus récente existe mais a été écartée parce qu'instable,
   **l'app le dit, version et canal à l'appui** — sans quoi rien ne distingue
   « dernière version publiée » de « dernière version stable », et le choix
   ressemble à un oubli. *Paramètres → Préférer une version stable* permet de
   basculer sur la plus récente quoi qu'il arrive.
4. **Dépendances** — les dépendances requises manquantes sont ajoutées
   récursivement, dans la bonne version.
5. **Versions épinglées** — certains mods n'exigent pas seulement la *présence* d'un
   autre mod, mais une **version précise**, parce qu'ils en réécrivent les
   classes internes. Iris 1.8.12 exige Sodium 0.6.13 ; à côté de Sodium 0.8.13,
   le pack s'installe normalement puis plante au chargement du monde sur un
   `ClassNotFoundException` qui ne nomme ni l'un ni l'autre.

   « La version la plus récente de chaque mod » et « un ensemble qui démarre »
   ne sont pas la même chose. Ces contraintes sont vérifiées, et l'écran propose
   soit de rétrograder la dépendance, soit de retirer le mod exigeant. Tant
   qu'un conflit reste, **l'export est bloqué**.

   Seul Modrinth publie ces contraintes ; les dépendances CurseForge ne
   désignent qu'un projet, sans version. Un conflit venant uniquement de
   CurseForge reste donc invisible.
6. **Doublons fonctionnels** — des mods différents qui font la même chose sont
   détectés : `bloquant` (deux moteurs de rendu = crash au démarrage) ou
   `redondant` (deux minimaps). Un clic écarte les autres.
7. **Fichiers de configuration** — seuls les fichiers fournis par plusieurs
   packs avec un contenu différent demandent un arbitrage. Par fichier : garder
   la version d'un pack précis, fusionner, tout garder (les non prioritaires
   renommés), ou ignorer.

### Mods introuvables

Un bouton **« Chercher une alternative pour les N mods »** traite tout le lot
d'un coup : progression, estimation du temps restant, arrêt possible à tout
moment sans perdre ce qui a déjà été trouvé. À la fin, un écran de revue
montre chaque remplacement proposé, et **seules les propositions qui sont un
projet original en version stable sont cochées d'office** — les forks et les
betas sont proposés mais laissés décochés. Chaque ligne permet de choisir une
autre proposition. Un repli mod par mod reste disponible.

Dans les deux cas, la recherche fonctionne ainsi :

- une **table d'équivalences curée** (`src/lib/core/merge/knowledge.ts`), qui
  encode ce qu'une recherche textuelle ne peut pas trouver : Sodium ne contient
  pas « OptiFine » dans son nom, Jade ne contient pas « Waila » ;
- une recherche sur les deux plateformes, notée sur la popularité, la
  fraîcheur de maintenance et la proximité du nom.

Trois garanties :

- **une proposition doit vraiment porter le nom du mod cherché.** La recherche
  textuelle des deux plateformes renvoie beaucoup de bruit : sans ce filtre,
  un mod simplement populaire et récent remonte en tête, et « Create » se voit
  proposer « Chimes ». Les compléments sont écartés aussi — « Refined Storage:
  Powerless Addon » dépend de Refined Storage au lieu de s'y substituer. Quand
  un nom tient en un seul mot, la ressemblance exigée est quasi totale ;
- **chaque proposition a réellement une version installable** sur la cible —
  les candidats sans version compatible sont écartés avant affichage ;
- **les forks sont pénalisés et étiquetés**. Un fork n'arrive en tête que si
  aucun projet original ne couvre la fonction, et l'interface le dit alors
  explicitement.

### Estimation de RAM

Calculée à partir de signaux réels du pack, pas d'une règle unique :

- coût de base du jeu selon la version de Minecraft ;
- coût par mod dégressif (les bibliothèques sont mutualisées) ;
- mods connus pour leur appétit (GregTech, Distant Horizons, refontes de
  biomes…) ou pour leurs économies (FerriteCore, ModernFix, Sodium) — l'effet
  des optimisations grandit avec la taille du pack, il n'est donc pas appliqué
  à taux plein sur un petit pack ;
- shaders et packs de ressources, côté client uniquement.

L'app donne une valeur client, une valeur serveur, un minimum, les arguments
JVM prêts à copier, et **le détail complet du calcul** pour que tu puisses
juger. Les ordres de grandeur obtenus : 50 mods → 4 Go, 150 mods → 6 Go,
150 mods + shaders → 8 Go, 250 mods → 7,5 Go.

### Ajouter du contenu

Un onglet par type, chacun avec son propre champ de recherche : **mods**,
**resource packs**, **shaders**, **datapacks**, **schématiques**. Ce n'est pas
cosmétique — chaque type se cherche différemment. Un resource pack n'est pas
publié sous un mod loader mais sous `minecraft`, un shader sous `iris` ou
`optifine`, un datapack sous `datapack` : interroger les API avec le loader du
pack ne renverrait rien du tout.

| Type | Modrinth | CurseForge | Destination |
|---|---|---|---|
| Mod | `project_type:mod` | classe 6 | `mods/` |
| Resource pack | `project_type:resourcepack` | classe 12 | `resourcepacks/` |
| Shader | `project_type:shader` | classe 6552 | `shaderpacks/` |
| Datapack | `project_type:datapack` | classe 6945 | `datapacks/` |
| Schématique | — | — | selon le mod détecté |

**Les schématiques n'ont pas d'API.** Aucune bibliothèque connue n'expose
d'interface interrogeable depuis un navigateur : `minecraft-schematics.com`
répond derrière une protection anti-robot et sans en-têtes CORS, et ni
Modrinth ni CurseForge n'ont de catégorie pour ce format. L'onglet ouvre donc
les bibliothèques dans un onglet et accepte les fichiers `.litematic`,
`.schem`, `.schematic` et `.nbt` déposés ensuite. Le dossier de destination
suit le mod détecté dans le pack : `schematics/` pour Litematica ou
Schematica, `config/worldedit/schematics/` pour WorldEdit, `blueprints/` pour
Axiom. Si aucun de ces mods n'est présent, l'app le dit plutôt que de livrer
des fichiers que rien ne pourra ouvrir.

### Téléchargements manuels

Certains auteurs interdisent la distribution de leur fichier par des tiers :
CurseForge renvoie alors le fichier sans lien de téléchargement. **Le lien CDN
resterait techniquement joignable ; l'outil ne l'utilise pas.** C'est un choix
de l'auteur, et le contourner n'appartient pas à un outil de fusion.

Le fonctionnement reprend celui de Prism Launcher : l'app ouvre la page du
fichier exact — bonne version déjà sélectionnée — et récupère ensuite ce qui a
été téléchargé. Deux façons de le lui rendre :

- **déposer les fichiers** (fonctionne partout) ;
- **autoriser une fois le dossier Téléchargements** : l'app le relit ensuite
  d'un clic. Cela demande l'API File System Access, donc Chrome, Edge ou Opera
  — une page web ne peut pas atteindre un dossier sans autorisation explicite,
  et seuls les fichiers dont l'extension correspond à ce qui manque sont
  ouverts.

Les fichiers rendus sont **appariés par empreinte sha1**, pas par nom : un
fichier renommé est reconnu. Quand l'empreinte attendue est connue et que le
fichier ne correspond pas, il est **refusé** avec la raison — accepter
`SubtleEffects-neoforge-1.21.1.jar` parce que son nom ressemble mettrait un jar
NeoForge dans un pack Fabric, qui s'installerait puis planterait au démarrage.
Le repli par le nom ne sert que lorsqu'aucune empreinte de référence n'existe.

Les échecs de téléchargement d'un export précédent (CDN qui refuse la requête)
rejoignent la même liste : le besoin est identique.

### Export

| Format | Pour |
|---|---|
| `.mrpack` | Modrinth App, Prism, ATLauncher, MultiMC |
| `.zip` CurseForge | CurseForge App, hébergeurs de serveurs |

Et deux modes :

- **Pack complet** — les `.jar` sont téléchargés et inclus dans
  `overrides/mods/`. S'installe partout, archive lourde.
- **Manifeste seul** — quelques Ko, le lanceur télécharge les mods. Le format
  natif est respecté quand c'est possible : un `.mrpack` ne peut référencer que
  des liens Modrinth, GitHub ou GitLab, donc les mods CurseForge sont de toute
  façon embarqués.

Un bouton **« Voir le récapitulatif »** ouvre l'inventaire avant génération :
par type de contenu, et surtout **par côté** — ce qui est client uniquement,
serveur uniquement, ou nécessaire des deux côtés, avec le poids correspondant.
C'est la liste qu'il faut pour monter un serveur dédié sans y copier des
shaders. Un troisième onglet montre les dépendances et ce qui les exige.

L'archive contient toujours un `RAPPORT-DE-FUSION.md` : l'inventaire complet
par type, la répartition client/serveur, ce qui a été gardé, remplacé, écarté,
abandonné, et la RAM recommandée avec son calcul.

#### Un pack incomplet ne sort pas

La génération est **refusée** tant qu'il manque quelque chose. Un modpack
auquel il manque des morceaux ne se voit pas : l'archive s'ouvre, s'installe,
et le jeu plante ou refuse la connexion des semaines plus tard.

Trois choses bloquent :

| Obstacle | Comment le lever |
|---|---|
| Deux mods qui exigent des versions incompatibles | rétrograder, ou retirer le mod exigeant |
| Élément sans version compatible | chercher une alternative, ou l'écarter |
| Fichier non distribuable par un tiers | le récupérer depuis sa page |
| Téléchargement échoué à la génération précédente | relancer, ou le récupérer à la main |

Un seul cas fait exception : un **manifeste CurseForge**, où les fichiers ne
sont que des numéros de projet et l'application CurseForge ouvre elle-même la
page quand l'auteur refuse la distribution. Un `.mrpack` n'a pas cette
possibilité, donc le fichier doit être là.

Rien ne se contourne en silence. Le seul moyen de passer outre est **d'écarter
explicitement** ce qui manque : le pack ne les contient alors pas, et le
`RAPPORT-DE-FUSION.md` le consigne. C'est une décision, pas un contournement.

Le verrou couvre aussi ce qui casse *pendant* la génération : chaque fichier
est retenté trois fois, et si l'un ne passe toujours pas, **rien n'est livré**
— le fichier en cours d'écriture est supprimé plutôt que de laisser une
archive tronquée qui ressemble à une archive valide.

#### Compatibilité de l'archive

L'archive est écrite par un writer maison plutôt que par un utilitaire tout
fait, pour deux raisons précises :

- un writer en flux ne connaît pas la longueur d'une entrée au moment d'écrire
  son en-tête local. Il y laisse donc CRC et tailles à zéro et pose le drapeau
  *data descriptor*. C'est légal, mais c'est la variante du format la plus mal
  supportée — **QuaZip, qu'utilise Prism Launcher, échoue dessus**. Ici chaque
  entrée est poussée entière, donc son empreinte et sa taille sont connues
  avant l'en-tête : elles y figurent, et aucun descripteur n'est nécessaire ;
- les enregistrements **Zip64** sont écrits quand il le faut. Sans eux une
  archive plafonne à 4 Go ou 65 535 entrées, ce qu'un pack complet de plusieurs
  centaines de mods dépasse.

Une destination n'est écrite qu'une fois : deux sources peuvent viser le même
chemin (un fichier `client-overrides/` et son équivalent commun repliés
ensemble pour le format CurseForge), et une archive contenant deux fois la même
entrée est acceptée par certains outils et refusée par d'autres.

#### Archives volumineuses

L'archive est écrite **en flux**, entrée par entrée : rien n'est assemblé en
mémoire. Un pack complet de 400 mods pèse facilement plus d'un gigaoctet, bien
au-delà de ce qu'un seul tableau d'octets peut couvrir dans un onglet — c'est
ce qui produisait l'erreur `Array buffer allocation failed`.

Les `.jar` sont stockés tels quels plutôt que recompressés : ce sont déjà des
archives, la recompression coûte du temps pour zéro octet gagné.

Quand le navigateur le permet (Chrome, Edge, Opera), l'app demande **où
enregistrer avant de commencer** et écrit directement dans ce fichier : le pic
mémoire reste de quelques mégaoctets quelle que soit la taille finale, et il
n'y a plus aucune limite. Ailleurs, l'archive est assemblée en `Blob` puis
téléchargée — ce qui fonctionne, mais le stockage de Blobs du navigateur a lui
aussi un plafond, autour de 2 Go.

## Architecture

```
src/
  app/
    page.tsx              étape 1 — choix et ordre des packs
    cible/                étape 2 — loader, version, lancement de la fusion
    mods/                 étape 3 — résultat, RAM, alternatives, conflits, ajout
    fichiers/             étape 4 — arbitrage des configs
    export/               étape 5 — génération de l'archive
    reglages/             paramètres
  components/
    ui/                   primitives shadcn/ui (Radix + Tailwind)
  lib/
    core/                 moteur isomorphe, sans aucune dépendance Node
      providers/          clients Modrinth et CurseForge (cache, retry, quotas)
      merge/
        knowledge.ts      équivalences, conflits, profils mémoire — le cœur éditorial
        resolve.ts        déduplication et choix de version
        pinned.ts         dépendances exigeant une version précise
        alternatives.ts   recherche et notation des remplaçants
        overrides.ts      fusion N-way des fichiers de config
        ram.ts            estimation de mémoire
      content.ts          types de contenu : dossiers, catégories d'API, côté
      summary.ts          inventaire du pack, par type et par côté
      parse.ts            lecture des trois formats de pack
      zip.ts              lecture protégée et écriture en flux des archives
      build.ts            génération de l'archive
    manual.ts             fichiers récupérés à la main (appariement, dossier surveillé)
    readiness.ts          ce qui doit être réuni avant de pouvoir générer
    save.ts               destination de l'archive : disque en flux ou Blob
    store.tsx             état de l'assistant (React context + IndexedDB)
    settings.ts           préférences (localStorage)
worker/                 code serveur (relais CurseForge et téléchargements)
deploy/                 fichiers copiés dans out/ après le build (_headers)
proxy/                  relais autonome, pour un hébergement sans code serveur
```

`lib/core` ne contient ni `node:*` ni `process.env` : c'est ce qui permet à
tout le moteur de tourner dans le navigateur.

Les archives sont conservées dans IndexedDB pour qu'un rechargement de page ne
fasse pas perdre le travail en cours. **Paramètres → Données locales** montre
la place occupée et permet de tout effacer.

## Étendre la base de connaissances

`src/lib/core/merge/knowledge.ts` est fait pour être complété à la main :

- `EQUIVALENCES` — familles de mods interchangeables, avec le remplaçant
  recommandé par loader (`prefer`) et les compagnons à ajouter (`also`, par
  exemple Iris en plus de Sodium pour remplacer OptiFine) ;
- `CONFLICT_GROUPS` — familles de mods qui ne doivent pas cohabiter, avec la
  sévérité et l'ordre de préférence ;
- `MEMORY_PROFILE` — surcoûts et économies mémoire par mod ;
- `LOADER_ONLY` — mods dont l'absence sur un loader donné est normale.

Deux exemples ajoutés depuis des packs réels : **Litematica → Forgematica** et
**MaLiLib → MaFgLib** sur Forge et NeoForge. Ce sont des portages sous un autre
nom : aucune recherche textuelle ne les rapproche, seule la table le peut.

Ajouter une entrée suffit, les index sont construits automatiquement.

## Sécurité

L'app est publique et avale des archives fournies par n'importe qui. Ce qui a
été traité :

| Vecteur | Traitement |
|---|---|
| **Bombe de décompression** | Le catalogue du zip est inspecté **avant** toute décompression : nombre d'entrées, taille décompressée et taux de compression. Une archive de 199 Ko qui donne 200 Mo est refusée avec un message clair. |
| **Zip slip** | Les chemins d'archive contenant `..`, un chemin absolu, une lettre de lecteur ou un octet nul sont ignorés, à la lecture comme à l'écriture. |
| **Pollution de prototype** | Les tables indexées par chemin d'archive utilisent un prototype nul, et la fusion JSON ignore `__proto__`, `constructor` et `prototype`. Elle teste la propriété propre plutôt que l'opérateur `in`, sans quoi une clé de config nommée `toString` était fusionnée contre la méthode héritée. |
| **SSRF** | Le relais de téléchargement n'accepte qu'une liste blanche de CDN, impose HTTPS, et **revalide la destination après chaque redirection** plutôt que de les suivre aveuglément. |
| **Proxy ouvert** | Le relais CurseForge ne transmet qu'une liste fermée de routes, ne recopie que les paramètres de requête attendus, plafonne les corps POST à 256 Ko et restreint l'origine appelante. |
| **Fuite de clé** | La clé CurseForge vit dans une variable d'environnement côté serveur et n'atteint jamais le navigateur. Le champ « clé API » côté client n'apparaît que si un relais externe est configuré, et prévient qu'il est déconseillé. |
| **Accès aux fichiers locaux** | Le dossier surveillé et la destination d'écriture sont choisis par l'utilisateur dans une fenêtre du système ; une page web ne peut pas y accéder autrement. À la relecture, seuls les fichiers dont l'extension correspond à ce qui manque sont ouverts. Rien ne quitte la machine. |
| **XSS** | Aucun `innerHTML` ni `eval`. Le seul script inline est une chaîne littérale qui applique le thème avant le premier rendu. Tout le contenu venant des API est rendu comme texte par React. |
| **Clickjacking, sniffing** | `deploy/_headers` pose `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` et une `Permissions-Policy` restrictive. GitHub Pages ne permet pas de définir d'en-têtes. |

**Injection SQL : sans objet.** Il n'y a ni base de données ni backend
applicatif — l'app ne fait que lire des archives et interroger deux API
publiques en lecture seule.

`npm audit` signale deux avis sur **PostCSS**, tiré transitivement par Next.
Ils concernent le traitement de CSS fourni par un attaquant, au moment de la
construction ; ici le CSS est celui du projet, et aucun correctif n'est
disponible en amont. Aucun impact à l'exécution.

Ce qui reste à ta charge si tu rends le site public : le relais consomme ton
quota CurseForge. Renseigne `ALLOWED_ORIGIN` (Worker du site) ou `ALLOWED_ORIGINS`
(Worker autonome) avec ton domaine, sinon n'importe qui peut l'utiliser.

## Limites connues

- **Sans relais CurseForge**, la moitié du catalogue est hors de portée.
- Le téléchargement des jars se fait depuis le navigateur : certains CDN
  refusent les requêtes venant d'une page web. Les mods concernés basculent
  dans *Téléchargements manuels*. Le mode *manifeste seul* évite le problème.
- **Mémoire.** Les archives sont lues en entier pour être ouvertes : compter
  environ 1,7 Go de pointe pour 1,1 Go de packs à la lecture, et 2,2 Go à
  l'export, où les fichiers d'instance des deux packs sont gardés le temps de
  les comparer. Un pack qui embarque un monde sauvegardé pèse lourd pour rien :
  sur les packs de test, `saves/` représente 1073 des 1847 fichiers de
  l'archive produite.
- Si le navigateur refuse de stocker les archives (navigation privée, quota
  dépassé), l'outil continue de fonctionner pour la session en cours et le dit,
  mais l'avancement ne survit pas à un rechargement.
- Un mod dont l'auteur a désactivé la distribution tierce sur CurseForge ne
  peut pas être téléchargé automatiquement — par respect de son choix, pas par
  impossibilité technique. L'écran *Téléchargements manuels* ouvre sa page et
  récupère le fichier.
- La lecture automatique du dossier Téléchargements demande Chrome, Edge ou
  Opera. Sur Firefox et Safari, il faut déposer les fichiers.
- Sur Firefox et Safari, l'archive passe par un `Blob` : au-delà d'environ
  2 Go, préférer le mode *manifeste seul*.
- Les schématiques ne se cherchent pas automatiquement : aucune bibliothèque
  n'expose d'API utilisable depuis un navigateur.
- La fusion ligne à ligne des configs traite le JSON et les formats clé=valeur
  (`toml`, `cfg`, `properties`, `ini`). Les autres formats demandent de choisir
  une version.
- Deux refontes de génération du monde sont signalées comme redondantes mais
  pas réconciliées : cela demande un datapack dédié.
