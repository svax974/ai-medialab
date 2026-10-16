# Migrations TypeORM

Migrations versionnées de la base de Nest (SQLite ; Postgres n'est pas une cible de cette application). Chargées par
`src/config/Datasource.ts` (`migrations/*.{js,ts}`, un seul niveau : les tests sont dans `tests/`).

| Fichier | Contenu |
|---|---|
| `1791891387395-InitialSchema.ts` | Tout le schéma de départ : tables de `common` (`config`, `themes`, `cookie_consent_log`) et de l'application (`conversations`, `messages`, `message_refs`, `assets`, `voices`, `import_markers`) avec leurs index et clés étrangères. |
| `1792061048743-UpdateAdvisories.ts` | Le conseiller de mises à jour : `update_advisories` (avis enregistrés sur une mise à jour de moteur ou de modèle : verdict, résumé, constats cités, sources, modèle utilisé), un index par élément et date. |
| `1792058442183-ChatTables.ts` | Le chat : `chat_messages` (arbre de messages, clés étrangères en cascade vers la conversation et le message parent) et `chat_conversation_settings` (réglages et feuille active de chaque conversation de chat). |
| `1792070000000-ChatGenerations.ts` | Les outils de création du chat : colonne `chat_messages.generations` (JSON, nullable : les messages existants ne changent pas). |

## Utilisation

- **Dev** : `DB_SCHEMA_MODE` non défini (ou `sync`), TypeORM construit les tables (`synchronize`, défaut hors production). Les migrations
  ne servent pas.
- **Bureau et production** : `DB_SCHEMA_MODE=migrations` (voir `back/.env.example`) : les migrations
  en attente s'exécutent au démarrage. Ne jamais mélanger `synchronize` et migrations sur un même fichier `app.db` : une
  base construite par `synchronize` n'a pas la table `migrations`, la migration initiale échouerait (« table already
  exists »). Repartir d'un `app.db` vide, ou le supprimer en dev (rien d'irremplaçable : les données d'origine sont dans
  l'ancienne base, réimportable en supprimant `app.db`).
- La base cible du bureau est créée par `DB_PATH` (relatif à `APP_DATA_DIR`).

## Générer une migration après un changement d'entité

Toute modification d'entité (voir la règle de sécurité TypeORM du gabarit : prévenir avant de renommer ou supprimer une
colonne) s'accompagne d'une migration, dans le même commit :

```sh
cd back
DB_ENGINE=sqlite DB_PATH=/tmp/gen.db CRYPT_DB_MASTER_KEY=<clé> \
  node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js \
  migration:generate -d src/config/Datasource.ts src/migrations/<Nom>
```

La base `DB_PATH` doit refléter le schéma **précédent** (appliquer d'abord les migrations existantes :
`migration:run -d src/config/Datasource.ts` avec les mêmes variables, sur un fichier neuf). Relire le fichier généré
(SQLite recrée les tables pour ajouter une clé étrangère) et lancer
`npx jest --runInBand src/migrations/tests/migrations.spec.ts` : il applique les migrations sur une base vide en
mémoire, vérifie qu'aucune différence ne subsiste avec les entités, les clés étrangères et le retour arrière.
