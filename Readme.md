# Plateforme de détection de fraudes dans les transactions bancaires

## Présentation du projet

Ce projet consiste à développer une plateforme intelligente permettant d'analyser des transactions bancaires afin d'identifier les opérations potentiellement frauduleuses.

La plateforme intègre un modèle de Machine Learning préalablement entraîné avec XGBoost. Elle permet d'analyser les transactions, d'estimer leur niveau de risque et de présenter les résultats dans une interface web. L'objectif est de faciliter la surveillance des opérations bancaires et de fournir une visualisation claire des transactions analysées.

Le projet s'appuie sur un jeu de données de transactions simulées afin de tester et de démontrer le fonctionnement du système.

## Fonctionnalités principales

- Détection de transactions potentiellement frauduleuses à l'aide d'un modèle XGBoost pré-entraîné.
- Analyse des transactions en temps réel à travers un flux de données simulé.
- Affichage des résultats de prédiction et du score de risque.
- Consultation de l'historique des transactions.
- Visualisation des statistiques et des indicateurs de fraude.
- Gestion des utilisateurs et authentification sécurisée par JWT.
- Administration des transactions et analyse de fichiers de données.
- Stockage des transactions et exploration des relations entre utilisateurs, cartes et commerçants.

## Architecture du projet

Le système suit une architecture organisée autour des composants suivants :

```text
Dataset de transactions
          |
          v
Simulateur de flux Python
          |
          v
Backend Spring Boot
          |
          v
Prétraitement des données
          |
          v
Modèle XGBoost pré-entraîné
          |
          v
Prédiction et score de risque
          |
          v
Base de données Neo4j
          |
          v
Tableau de bord web
```

Les résultats peuvent être transmis au tableau de bord en temps réel à l'aide de WebSocket, tandis que l'API REST permet les échanges classiques entre le frontend et le backend.

## Technologies utilisées

| Technologie | Utilisation |
|---|---|
| Python | Simulation du flux de transactions et intégration du modèle |
| XGBoost | Classification des transactions et détection des fraudes |
| Spring Boot | Développement du backend et des API REST |
| HTML, CSS et JavaScript | Développement de l'interface web |
| Neo4j | Stockage des données et représentation des relations |
| WebSocket | Transmission des résultats en temps réel |
| JWT | Authentification et gestion des accès |
| Docker | Conteneurisation et déploiement des composants |

## Modèle de Machine Learning

Le système utilise un modèle XGBoost entraîné au préalable sur des données transactionnelles. Le modèle est intégré à l'application afin d'effectuer des prédictions sans nécessiter un nouvel entraînement à chaque lancement.

Le processus d'analyse comprend les étapes suivantes :

1. Réception d'une transaction.
2. Préparation des données selon le pipeline de prétraitement du modèle.
3. Application du modèle XGBoost.
4. Calcul de la prédiction et, selon la configuration du modèle, du score de risque.
5. Enregistrement du résultat et transmission à l'interface.

La qualité des prédictions dépend des caractéristiques utilisées lors de l'entraînement, du prétraitement appliqué et des données reçues.

## Simulation des transactions en temps réel

Afin de reproduire un scénario proche d'un système de surveillance bancaire, un simulateur Python lit les transactions d'un fichier CSV et les transmet progressivement au backend.

Chaque transaction reçue est analysée par le modèle. Le résultat est ensuite enregistré et envoyé au tableau de bord, permettant de suivre l'évolution des opérations sans actualiser manuellement la page.

Cette simulation permet de tester le fonctionnement de la plateforme dans un environnement contrôlé.

## Base de données Neo4j

Neo4j permet de représenter les relations entre les principales entités du système :

- `User` : utilisateur associé à une transaction.
- `Card` : carte utilisée pour effectuer une opération.
- `Transaction` : opération bancaire analysée.
- `Merchant` : commerçant auprès duquel l'achat est effectué.

Les relations permettent notamment de relier un utilisateur à sa carte, une carte aux transactions qu'elle effectue et chaque transaction au commerçant concerné.

## Sécurité et gestion des accès

L'application prévoit un système d'authentification basé sur JWT avec deux rôles :

- `ADMIN` : accès aux fonctionnalités d'administration et à la supervision des transactions.
- `USER` : accès aux fonctionnalités personnelles et à l'historique de ses transactions.

Les accès aux fonctionnalités doivent être contrôlés côté backend. Les données sensibles, notamment les numéros de carte, doivent être protégées et masquées lorsqu'un affichage complet n'est pas nécessaire.

## Installation et exécution

Les étapes exactes d'installation dépendent de la configuration du projet et des fichiers fournis.

### Prérequis

- Python et les dépendances du modèle.
- Java et Maven pour le backend Spring Boot.
- Neo4j.
- Docker et Docker Compose, si le déploiement conteneurisé est utilisé.

### Étapes générales

1. Cloner le dépôt :

   ```bash
   git clone <URL_DU_DEPOT>
   cd <NOM_DU_PROJET>
   ```

2. Configurer les variables d'environnement nécessaires, notamment les paramètres de connexion à Neo4j et la configuration de sécurité.

3. Installer les dépendances Python requises par le simulateur et l'intégration du modèle.

4. Démarrer Neo4j et le backend Spring Boot.

5. Lancer le frontend web.

6. Démarrer le simulateur Python pour envoyer les transactions et observer les résultats sur le tableau de bord.

Si Docker Compose est configuré dans le dépôt, les composants peuvent être démarrés à l'aide de la commande :

```bash
docker compose up --build
```

Cette commande suppose qu'un fichier `compose.yaml` ou `docker-compose.yml` est présent et correctement configuré à la racine du projet.

## Structure indicative du projet

```text
bank-fraud-detection/
├── backend/
├── frontend/
├── model/
├── stream-simulator/
├── data/
├── docker-compose.yml
├── .env.example
└── README.md
```

Cette structure est indicative et doit être adaptée à l'organisation réelle du dépôt.

## Jeu de données

Le projet utilise des données de transactions simulées issues du jeu de données Sparkov. Ces données servent à tester le traitement des transactions et à démontrer le fonctionnement du modèle dans un environnement expérimental.

Les résultats obtenus sur ces données ne garantissent pas les mêmes performances sur des transactions bancaires réelles.

## Objectifs du projet

- Intégrer un modèle de Machine Learning pré-entraîné dans une application web.
- Mettre en place une chaîne de traitement de transactions simulées en temps réel.
- Combiner une API backend, une interface web et une base de données orientée graphe.
- Présenter les résultats de détection de manière claire et exploitable.
- Concevoir une architecture modulaire pouvant évoluer vers des scénarios plus proches des besoins opérationnels.

## Avertissement

Ce projet est réalisé dans un cadre académique et expérimental. Il ne constitue pas un système bancaire de production et ne doit pas être utilisé pour prendre automatiquement des décisions financières réelles sans validation approfondie.

## Statut du projet

Projet académique en cours de développement.
