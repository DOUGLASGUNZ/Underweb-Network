// What an account gets you. `live` = works today; `soon` = approved and being built,
// shown with a "Coming soon" tag so nobody signs up for something that isn't there yet.

export const MEMBER_PERKS = [
    {
        id: 'silk',
        icon: 'silk',
        title: 'Your Silk, saved',
        body: 'Earn Silk for showing up at the hub (with UWX), events, streaks, approved photos and bringing friends. It stays in your account and puts you on the weekly leaderboard. Spending it in the hub casino is next.',
        status: 'live'
    },
    {
        id: 'suite',
        icon: 'lock',
        title: 'Book a VIP suite',
        body: 'Reserve a private suite in the hub for you and your friends, right from the site.',
        status: 'soon'
    },
    {
        id: 'drop',
        icon: 'gift',
        title: 'A free Darko drop every month',
        body: 'A members-only shader or asset each month, plus a member discount on the Darko shop.',
        status: 'soon'
    },
    {
        id: 'friend',
        icon: 'friend',
        title: 'Bring a friend, both win',
        body: 'When a friend you invite verifies, you both get Silk — and a free suite night.',
        status: 'soon'
    },
    {
        id: 'hub',
        icon: 'stage',
        title: 'Creators: a real spot in the hub',
        body: 'Your card on the Creator Market wall or the DJ stage screen, with a QR code to your shop or music. Staff approve it, the hub shows it.',
        status: 'live'
    },
    {
        id: 'featured',
        icon: 'screen',
        title: 'Creators: featured every week',
        body: 'Approved photos and art play on the hub wall and post to the Discord, and one creator is featured on the hub screen each week.',
        status: 'live'
    }
];

// One tab per kind of creator, so nobody reads a DJ pitch when they build worlds.
export const CREATOR_TYPES = [
    {
        id: 'dj',
        label: 'DJs',
        pitch: 'Get heard at UnderWeb events and hangouts.',
        perks: [
            { text: 'Resident DJ card on the hub stage screen — your logo, name and a QR to your music', status: 'live' },
            { text: '"Now on decks" card on the screen while you play', status: 'soon' },
            { text: 'Request slots at events and hangouts from your profile', status: 'soon' },
            { text: 'Your sets posted to the Discord', status: 'soon' }
        ]
    },
    {
        id: 'avatars',
        label: 'Avatars & assets',
        pitch: 'Put your shop in front of everyone who walks through the hub.',
        perks: [
            { text: 'Creator Market card in the hub — art, name, headline and a QR straight to your shop', status: 'live' },
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
            { text: 'Your video plays before events on the hub screen', status: 'soon' }
        ]
    }
];
