// French v2.1 strings.
import type { ExtraDict } from './extra.en';

const extra: ExtraDict = {
  ux: {
    toCollect: 'À encaisser', seeAll: 'Tout voir', recent: 'Activité récente', noDebts: 'Personne ne vous doit d’argent pour le moment.',
    periodToday: 'Aujourd’hui', periodWeek: 'Cette semaine', periodMonth: 'Ce mois', profitFor: 'Bénéfice · {{period}}', salesFor: 'Ventes', expensesFor: 'Dépenses',
    search: 'Rechercher clients, produits, factures…', searchTitle: 'Rechercher', noResults: 'Aucun résultat', actions: 'Actions',
    customers: 'Clients', products: 'Produits', invoices: 'Factures', groups: 'Groupes',
    fromContacts: 'Choisir dans les contacts', pull: 'Tirer pour synchroniser', release: 'Relâcher pour synchroniser', refreshing: 'Synchronisation…',
    keypad: 'Clavier calculatrice', equals: '= {{amount}}', remind: 'Relancer', youGave: 'Vous avez donné', youGot: 'Vous avez reçu',
  },  tax: {
    title: 'Taxes et reçus', help: 'Indiquez votre taux de TVA (0 si vous n’êtes pas assujetti).', rate: 'Taux de taxe (%)', tin: 'Numéro fiscal (NIF)',
    pricesAre: 'Mes prix…', inclusive: 'incluent déjà la taxe', exclusive: 'n’incluent pas la taxe (ajoutée en plus)', footer: 'Message sur le reçu',
    subtotal: 'Sous-total', discount: 'Remise', discounts: 'Remises accordées', tax: 'Taxe', included: 'incluse', collected: 'Taxe collectée',
  },
  returns: {
    title: 'Retour d’articles', refund: 'Remboursement', refunds: 'Remboursements', help: 'Indiquez combien de chaque article est retourné. Le stock est remis automatiquement.',
    left: '{{n}} retournable(s)', refundWith: 'Rembourser le client par', creditNote: 'Vente à crédit : la dette du client est réduite au lieu d’un remboursement.',
    confirm: 'Confirmer le retour', saved: 'Retour enregistré',
  },
  closing: {
    title: 'Clôturer la journée', help: 'Comptez l’argent de la caisse en fin de journée. Kopor le compare à vos écritures.',
    last: 'Dernière clôture {{date}} · écart {{diff}}', float: 'Fond de caisse ce matin', cashSales: 'Ventes en espèces aujourd’hui', cashOut: 'Sorties en espèces aujourd’hui',
    expected: 'Espèces attendues en caisse', counted: 'Espèces comptées', difference: 'Écart',
    repaidNote: 'Remboursements de dettes reçus aujourd’hui : {{amount}}. S’ils ont été payés en espèces, ils sont aussi dans la caisse.',
    balanced: 'Parfait : la caisse correspond à vos écritures.', over: 'Il y a {{amount}} DE PLUS que prévu. Vérifiez les ventes non enregistrées.',
    short: 'Il manque {{amount}}. Vérifiez les dépenses non enregistrées ou l’argent manquant.', save: 'Enregistrer la clôture', saved: 'Journée clôturée',
  },
  plan: {
    title: 'Kopor Pro', freeSub: 'Offre gratuite', proActive: 'Pro actif', proUntil: 'Pro jusqu’au {{date}}', current: 'Votre offre',
    pitch: 'Développez-vous avec plus de succursales, plus de personnel et plus d’aide IA.', unlimited: 'Illimité',
    f: { records: 'Crédit, caisse, stock, tontines, factures', offline: 'Fonctionne hors ligne', branches: 'Succursales', staff: 'Comptes du personnel', ai: 'Requêtes IA (cloud)', support: 'Support prioritaire' },
    buyMonth: 'Passer à Pro · {{price}} / mois', buyYear: 'Pro pour un an · {{price}} (2 mois offerts)',
    payNote: 'Paiement sécurisé par Orange Money, Afrimoney ou carte via Monime.', ownerOnly: 'Seul le propriétaire peut changer d’offre.',
  },
  help: {
    title: 'Aide', sub: 'Réponses, tutoriel et support', tour: 'Revoir le tutoriel', contact: 'Écrire au support Kopor sur WhatsApp',
    q: {
      start: 'Comment commencer ?', credit: 'Comment suivre qui me doit de l’argent ?', offline: 'Kopor fonctionne-t-il sans internet ?', backup: 'Comment ne pas perdre mes données ?',
      staff: 'Mes employés peuvent-ils utiliser Kopor ?', payments: 'Comment mes clients me paient-ils par mobile money ?', ai: 'Comment fonctionne « Parler » ?',
      printer: 'Puis-je imprimer des reçus ?', tax: 'Comment ajouter la TVA ?', pro: 'Qu’apporte Kopor Pro ?',
    },
    a: {
      start: 'Ajoutez vos produits dans Stock, puis enregistrez chaque vente et dépense depuis l’Accueil. Kopor calcule votre bénéfice.',
      credit: 'Pour une vente à crédit, choisissez « À crédit » comme mode de paiement, ou Crédit → Nouvelle écriture. Touchez un client pour envoyer un rappel WhatsApp.',
      offline: 'Oui. Tout fonctionne hors ligne et est enregistré sur votre téléphone. Avec un compte cloud, la synchronisation se fait au retour d’internet.',
      backup: 'Réglages → Sauvegarde télécharge un fichier (avec mot de passe possible). Ou créez un compte cloud pour une sauvegarde automatique.',
      staff: 'Oui. Dans Équipe, ajoutez du personnel avec un rôle (gérant, caissier ou lecteur). Chacun peut avoir son PIN sur un téléphone partagé.',
      payments: 'Touchez Recevoir sur l’accueil. Enregistrez une fois vos numéros Orange Money, Afrimoney ou QMoney, puis envoyez une demande de paiement ou montrez un QR code. Quand l’argent arrive, touchez « J’ai reçu l’argent » pour l’enregistrer. Pour envoyer, touchez Envoyer : Kopor ouvre votre menu mobile money puis enregistre le paiement. Connectez Monime pour des paiements qui se confirment seuls.',
      ai: 'Touchez Parler et dites ce qui s’est passé, par ex. « Vendu 2 sacs de riz 1700 ». Kopor prépare l’écriture à vérifier.',
      printer: 'Oui, sur imprimante thermique Bluetooth (58 ou 80 mm). Réglages → Imprimante de reçus. Les imprimantes Bluetooth classiques passent par l’app gratuite RawBT.',
      tax: 'Réglages → Taxes et reçus. Indiquez le taux et si vos prix incluent déjà la taxe.',
      pro: 'Plus de succursales, personnel illimité, plus d’IA et un support prioritaire. L’offre gratuite reste gratuite pour une boutique.',
    },
  },
  legal: { privacy: 'Politique de confidentialité', terms: 'Conditions d’utilisation' },
  printer: {
    title: 'Imprimante de reçus', help: 'Imprimez des reçus sur une imprimante thermique Bluetooth.', width: 'Largeur du papier', connection: 'Connexion',
    ble: 'Bluetooth (direct)', rawbt: 'App RawBT (imprimantes Bluetooth classiques)', rawbtHelp: 'Installez l’app gratuite « RawBT » depuis Google Play et associez-y votre imprimante. Kopor lui envoie les reçus.',
    pair: 'Choisir l’imprimante', paired: 'Imprimante', pairedOk: 'Imprimante connectée', test: 'Imprimer un reçu test', print: 'Imprimer le reçu', sent: 'Envoyé à l’imprimante', thanks: 'Merci pour votre confiance !',
  },
  export: { title: 'Export', help: 'Téléchargez toutes vos données dans un fichier Excel (ouvre aussi dans Google Sheets).', excel: 'Télécharger le fichier Excel', pdf: 'Partager en PDF', roundCol: 'Tour' },
  scan: {
    scan: 'Scanner un code-barres', find: 'Scanner pour trouver', help: 'Pointez la caméra vers le code-barres.', denied: 'Autorisez la caméra pour scanner.',
    noCamera: 'Aucune caméra disponible.', notFound: 'Aucun produit avec le code {{code}}. Ajoutez-le d’abord dans Stock.',
  },
  tour: {
    next: 'Suivant', prev: 'Retour', done: 'Commencer',
    welcomeTitle: 'Bienvenue sur Kopor 👋', welcome: 'Une visite de 30 secondes des fonctions essentielles.',
    profitTitle: 'Votre bénéfice du jour', profit: 'Ventes moins dépenses, mis à jour à chaque saisie.',
    quickTitle: 'Saisie en un geste', quick: 'Ajoutez une vente, une dépense ou un crédit ici. Tout est enregistré immédiatement, même hors ligne.',
    speakTitle: 'Parlez simplement', speak: 'Dites ce qui s’est passé et Kopor l’écrit pour vous.',
    insightsTitle: 'Conseils intelligents', insights: 'Kopor vous dit qui relancer, ce qui va manquer et l’évolution des ventes.',
    navTitle: 'Tout le reste', nav: 'Cahier de crédit, caisse, stock et plus, toujours à portée de main.',
  },
  crash: { title: 'Désolé, une erreur est survenue', text: 'Vos données sont en sécurité. Rechargez pour continuer.', reload: 'Recharger' },
  account: {
    delete: 'Supprimer mon compte', confirm: 'Supprimer votre compte Kopor ? Vous serez retiré de tous les commerces, et ceux dont vous êtes le seul propriétaire seront fermés. Action irréversible.',
    deleted: 'Compte supprimé',
  },
  errx: {
    inviteBad: 'Ce code est incorrect, déjà utilisé ou expiré, ou ce compte utilise un autre numéro que celui invité.', inviteRole: 'Seul le propriétaire peut inviter du personnel.', inviteMember: 'Ajoutez d’abord un numéro pour cette personne, puis enregistrez.', inviteSignIn: 'Connectez-vous d’abord à votre compte cloud Kopor (Plus → Cloud et compte).',
    recoverBad: 'Le numéro ou le code de récupération est incorrect.', recoverLocked: 'Trop d’essais. Réessayez dans une heure.',
    offline: 'Pas de connexion internet. Vos données sont en sécurité sur ce téléphone. Vérifiez vos données mobiles ou le Wi-Fi et réessayez.',
    returnTooMany: 'Impossible de retourner plus de {{name}} que vendu.', voidPaid: 'Seules les factures impayées peuvent être annulées. Enregistrez plutôt un retour.',
    proLimit: 'L’offre gratuite permet {{limit}}. Passez à Kopor Pro pour plus.', noBluetooth: 'L’impression Bluetooth n’est pas disponible dans ce navigateur. Utilisez Chrome sur Android ou l’option RawBT.',
    printerService: 'Ce type d’imprimante n’est pas pris en charge en Bluetooth LE. Essayez l’option RawBT.', noPrinter: 'Choisissez d’abord une imprimante dans Réglages.',
  },
};
export default extra;
