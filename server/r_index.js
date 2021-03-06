const express = require("express");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const socketio = require("socket.io");
const { OAuth2Client } = require("google-auth-library");

const { User, Game } = require("./classes");

const G_CLIENT_ID = "406419867255-aiscktvrh9qgf35pi1602b5pmt15040g.apps.googleusercontent.com";
const port = 3001;

const expressApp = express();
const httpServer = http.createServer(expressApp);
const gClient = new OAuth2Client(G_CLIENT_ID);
const socketServer = socketio(httpServer);

httpServer.listen(port, () => {
    console.log("listening on port", port);
});

expressApp.use(express.static(path.join(__dirname, "../build")));

const state = {
    users: {},
    games: {},
    nextGameID: 0
};

socketServer.on("connection", socket => {
    console.log("Anonymous Socket Connected!");
    let userID = 0; // This is the userToken for the user related to THIS socket

    socket.on("authenticate", (userToken, sendResponse) => {
        console.log("Got authenticate event")
        verifyToken(userToken).then(userData => {
            userID = userData.userid;
            if (state.users[userID]) {
                let user = state.users[userID];
                console.log("User was here before");
                user.socket = socket;
                if (user.avatar === -1) {
                    sendResponse({goTo: "avatar"});
                } else if (user.inGame !== -1) {
                    sendResponse({goTo: "game", id: user.inGame});
                }
                else {
                    sendResponse({goTo: "home"});
                }
            } else {
                console.log("User was not here before, make new 'account'");
                state.users[userID] = new User(userID, userData.name, socket);
                sendResponse({goTo: "avatar"});
            }
            console.log("Got user:", userData);
        }).catch(error => {
            console.log("Bad things happened:", error);
        });
    });

    socket.on("setAvatar", (avatarIndex, sendResponse) => {
        if (userID) {
            state.users[userID].avatar = avatarIndex;
            sendResponse();
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " set their avatar");
        }
    });

    socket.on("createGame", sendResponse => {
        if (userID) {
            let gameID = state.nextGameID++;
            state.games[gameID] = new Game(gameID, userID);
            state.users[userID].inGame = gameID;
            sendResponse(gameID);
            lobbyUpdate();
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " created game " + gameID);
        }
    });

    socket.on("deleteGame", (gameID, sendResponse) => {
        if (userID && state.games[gameID].creator == userID) {
            state.games[gameID].playerOrder.forEach(playerID => {
                state.users[playerID].inGame = -1;
            });
            delete state.games[gameID];
            sendResponse();
            socketServer.to("game"+ gameID).emit("gameDeleted");
            lobbyUpdate();
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " deleted game " + gameID);
        }
    });

    socket.on("joinLobby", () => {
        if (userID) {
            socket.join("lobby");
            lobbyUpdate();
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " joined the lobby");
        }
    });

    socket.on("leaveLobby", () => {
        if (userID) {
            socket.leave("lobby");
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " left the lobby");
        }
    });

    socket.on("joinGame", (gameID, sendResponse) => {
        if (userID) {
            if (state.games[gameID].addPlayer(userID)) {
                state.users[userID].inGame = gameID;
                sendResponse(true);
                gameUpdate(gameID);
                lobbyUpdate();
                console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " joined game " + gameID);
            } else {
                sendResponse(false);
            }
        }
    });

    socket.on("leaveGame", (gameID, sendResponse) => {
        if (userID) {
            if (state.games[gameID].started) {
                socketServer.to("game" + gameID).emit("gameOver", "cancelled");
                state.games[gameID].playerOrder.forEach(playerID => {
                    state.users[playerID].inGame = -1;
                });
                delete state.games[gameID];
            } else {
                state.games[gameID].removePlayer(userID);
                state.users[userID].inGame = -1;
                sendResponse();
                gameUpdate(gameID);
                lobbyUpdate();
                console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " left game " + gameID);
            }
        }
    });

    socket.on("joinGameRoom", (gameID, sendResponse) => {
        if (userID && state.games[gameID] && state.games[gameID].players[userID]) {
            socket.join("game" + gameID);
            gameUpdate(gameID);
            handUpdate([userID], gameID);
            sendResponse(true);
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " joined room for game " + gameID);
        } else {
            sendResponse(false);
        }
    });

    socket.on("leaveGameRoom", gameID => {
        if (userID) {
            socket.leave("game" + gameID);
            console.log(state.users[userID].name + "_" + state.users[userID].id.slice(0, 5) + " left room for game " + gameID);
        }
    });

    socket.on("startGame", gameID => {
        if (userID && state.games[gameID].creator == userID) {
            state.games[gameID].deal();
            gameUpdate(gameID);
            handUpdate(state.games[gameID].playerOrder, gameID);
            sendMessage(gameID, "Welcome!");
            socketServer.to("game" + gameID).emit("gameStart");
            state.games[gameID].started = true;
        }
    });

    socket.on("ask", payload => {
        let {askerID, responderID, cardID, cardName, gameID} = payload;
        let game = state.games[gameID];

        if (userID && game.playerOrder[game.currentTurn] === userID) {
            sendMessage(gameID, state.users[responderID].name + " do you have a " + cardName + "? - " + state.users[askerID].name);
            setTimeout(() => {
                let gameOver = false;
                if (game.askForCard(askerID, responderID, cardID)) {
                    if (game.players[askerID].hand.length === 0 || game.players[responderID].hand.length === 0) {
                        gameOver = true;
                    }
                    gameUpdate(gameID);
                    handUpdate([askerID, responderID], gameID);
                    sendMessage(gameID, "Yes I have a " + cardName + ". - " + state.users[responderID].name);
                } else if (game.goFish(askerID)) {
                    if (game.players[askerID].hand.length === 0) {
                        gameOver = true;
                    }
                    game.nextTurn();
                    gameUpdate(gameID);
                    handUpdate([askerID], gameID);
                    sendMessage(gameID, "Go Fish! - " + state.users[responderID].name);
                } else {
                    gameOver = true;
                }

                if (gameOver) {
                    // There are no more cards, the game is over
                    let {winners, losers} = game.findWinner();
                    if (winners.length > 1) {
                        winners.forEach(winnerID => {
                            state.users[winnerID].socket.emit("gameOver", "tie");
                        });
                    } else {
                        state.users[winners[0]].socket.emit("gameOver", "win");
                    }
                    losers.forEach(loserID => {
                        state.users[loserID].socket.emit("gameOver", "lose");
                    });
                    // Delete the game
                    state.games[gameID].playerOrder.forEach(playerID => {
                        state.users[playerID].inGame = -1;
                    });
                    delete state.games[gameID];
                }
            }, 2000);
        }
    });

    socket.on("anonymize", (sendResponse) => {
        if (userID) {
            state.users[userID].socket = null;
            userID = 0;
            sendResponse();
            console.log("Socket Anonymized");
        }
        
    });

    socket.on("disconnect", () => {
        if (userID) {
            state.users[userID].socket = null;
            userID = 0;
        }
        console.log("Socket Disconnected");
    });
});

async function verifyToken(idToken) {
    const ticket = await gClient.verifyIdToken({ idToken, audience: G_CLIENT_ID });

    const payload = ticket.getPayload();
    const userid = payload['sub'];
    const name = payload['given_name'];

    return {userid, name};
}

  function lobbyUpdate() {
      let payload = [];
    for (let key in state.games) {
        let game = state.games[key];
        let numPlayers = game.playerOrder.length;
        if (numPlayers < 4 && !game.started) {
            payload.push({id: key, name: "Game " + key, numPlayers});
        }
    }
    socketServer.to("lobby").emit("lobbyUpdate", payload);
    console.log("Sent update for lobby");
}

function gameUpdate(gameID) {
    const game = state.games[gameID];
    let payload = {
        players: game.playerOrder.map((playerID) => {
            return {
                id: playerID,
                numCards: game.players[playerID].hand.length,
                points: game.players[playerID].points,
                name: state.users[playerID].name,
                avatar: state.users[playerID].avatar
            };
        }),
        currentTurn: game.currentTurn,
        creator: game.creator,
        gameStarted: game.started
    };
    socketServer.to("game" + gameID).emit("gameUpdate", payload);
    console.log("Sent update for game " + gameID);
}

function handUpdate(usersToUpdate, gameID) {
    usersToUpdate.forEach(userID => {
        state.users[userID].socket.emit("handUpdate", state.games[gameID].players[userID].hand);
    });
    console.log("Sent hand updates to:", usersToUpdate.map(userID => (state.users[userID].name + "_" + state.users[userID].id.slice(0, 5))));
}

function sendMessage(gameID, message) {
    socketServer.to("game" + gameID).emit("messageUpdate", message);
    console.log("Sent message \"" + message + "\" to Game " + gameID);
}
