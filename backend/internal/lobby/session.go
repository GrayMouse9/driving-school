package lobby

type Session struct {
	ID            string `json:"id"`
	PlayersOnline int    `json:"playersOnline"`
	MaxPlayers    int    `json:"maxPlayers"`
}
