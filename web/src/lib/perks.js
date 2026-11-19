// What an account gets you. `live` = works today; `soon` = approved and being built,
// shown with a "Coming soon" tag so nobody signs up for something that isn't there yet.

export const MEMBER_PERKS = [
    {
        id: 'silk',
        icon: 'silk',
        title: 'One Silk balance',
        body: 'Your casino balance shows on your account. Silk you earn on the site (hub check-ins, events, streaks, approved photos) lands in the casino by itself.',
        status: 'live'
    },
    {
        id: 'whales',
        icon: 'badge',
        title: 'Leaderboard & Hall of Whales',
        body: 'See where you rank and every whale plaque in the casino, right from your phone.',
        status: 'live'
    },
    {
        id: 'friend',
        icon: 'friend',
        title: 'Bring a friend, get paid',
        body: 'Every friend you bring in that staff verify drops a stack of Silk into your casino balance.',
        status: 'live'
    },
    {
        id: 'signal',
        icon: 'stage',
        title: 'Signal: live DJ nights',
        body: 'Our live-music world. Set times and who is on decks, posted here first.',
        status: 'soon'
    },
    {
        id: 'hub',
        icon: 'screen',
        title: 'Creators: a spot on the floor',
        body: 'Your card on the Creator Market wall in the casino, with a QR code to your shop. Staff approve it, the casino shows it.',
        status: 'live'
    },
    {
        id: 'drop',
        icon: 'gift',
        title: 'A free Darko drop every month',
        body: 'A members-only shader or asset each month, plus a member discount on the Darko shop.',
        status: 'soon'
    }
];

// One tab per kind of creator, so nobody reads a DJ pitch when they build worlds.
export const CREATOR_TYPES = [
    {
        id: 'dj',
        label: 'DJs',
        pitch: 'Play Signal, our live-music world.',
        perks: [
            { text: 'Resident DJ card on the Signal screen — your logo, name and a QR to your music', status: 'soon' },
            { text: '"Now on decks" card on the screen while you play', status: 'soon' },
            { text: 'Request set times at Signal from your profile', status: 'soon' },
            { text: 'Your sets posted to the Discord', status: 'soon' }
        ]
    },
    {
        id: 'avatars',
        label: 'Avatars & assets',
        pitch: 'Put your shop in front of everyone on the casino floor.',
        perks: [
            { text: 'Creator Market card in the casino — art, name, headline and a QR straight to your shop', status: 'live' },
            { text: 'Featured creator of the week on the hub screen', status: 'live' },
            { text: 'Showcase page on the site with your best work', status: 'live' }
        ]
    },
    {
        id: 'worlds',
        label: 'Worlds',
        pitch: 'Get people into the worlds you built.',
        perks: [
            { text: 'Showcase page on the site with your worlds', status: 'live' },
            { text: '"World of the week" poster in the hub', status: 'soon' },
            { text: 'Host an UnderWeb hangout in your world', status: 'soon' }
        ]
    },
    {
        id: 'photos',
        label: 'Photos & art',
        pitch: 'Your shots on the walls of the hub.',
        perks: [
            { text: 'Approved photos and art on the hub wall — tick "show on the hub wall"', status: 'live' },
            { text: 'Posted to the UnderWeb Discord with credit, if you tick the box', status: 'live' },
            { text: 'Featured creator of the week on the hub screen', status: 'live' }
        ]
    },
    {
        id: 'video',
        label: 'Video',
        pitch: 'Open our nights with your work.',
        perks: [
            { text: 'Showcase page on the site with your videos', status: 'live' },
            { text: 'Your video plays before sets on the Signal screen', status: 'soon' }
        ]
    }
];
