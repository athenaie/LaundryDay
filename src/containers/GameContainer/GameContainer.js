import React, { Component } from "react";

import GameLobby from "../../components/GameLobby/GameLobby";
import Playing from "../Playing/Playing";
import EndPage from "../../components/EndPage/EndPage";
import { withAuth } from "../../context/AuthContext/AuthContext";
import { withSocket } from "../../context/SocketContext/SocketContext";

class GameContainer extends Component {
    state = {
        players: [],
        currentTurn: null,
        creator: null,
        gameStarted: false,
        gameOver: false,
        thisPlayerID: null,
        thisPlayerHand: [],
        message: "",
        selectedCard: null,
        selectedOpponent: null,
        mickProof: true // prevent pro-gamers from playing faster than the server
    }

    isThisPlayersTurn = () => this.state.thisPlayerID === this.state.players[this.state.currentTurn].id;
    clearSelections = () => this.setState({ selectedCard: null, selectedOpponent: null });
    askAllowed = () => this.isThisPlayersTurn() && this.state.selectedOpponent !== null && this.state.selectedCard !== null;

    componentDidMount() {
        let thisPlayerID = this.props.gAuth.currentUser.get().getId();

        this.props.socket.on("gameUpdate", payload => {
            // assign turn to players
            payload.players.map((player, index) => {
                player.turn = index === payload.currentTurn;
                return player;
            });

            this.clearSelections();

            // move thisPlayer to the end of the list
            while (payload.players[payload.players.length - 1].id !== this.state.thisPlayerID) {
                payload.players.unshift(payload.players.pop());
                payload.currentTurn = (payload.currentTurn + 1) % payload.players.length;
            }

            payload.mickProof = false;
            this.setState(payload);
        });

        this.props.socket.on("handUpdate", payload => {
            this.setState({thisPlayerHand: payload});
        });

        this.props.socket.on("messageUpdate", payload => {
            this.setState({message: payload});
        });

        this.props.socket.on("gameStart", () => {
            this.setState({gameStarted: true});
        });

        this.props.socket.on("gameOver", payload => {
            this.setState({gameOver: payload});
        });

        this.props.socket.on("gameDeleted", () => {
            this.props.history.push("/lobby");
        });

        this.setState({thisPlayerID: thisPlayerID});
        
        this.props.socket.emit("joinGameRoom", this.props.match.params.id, gameExists => {
            if (!gameExists) {
                this.props.history.replace("/lobby");
            }
        });
    }

    componentWillUnmount() {
        this.props.socket.emit("leaveGameRoom");
        this.props.socket.removeAllListeners();
    }

    handleCloseGame = () => {
        this.props.socket.emit("deleteGame", this.props.match.params.id, () => {
            this.props.history.push("/lobby");
        });
    }

    handleLeaveGame = () => {
        this.props.socket.emit("leaveGame", this.props.match.params.id, () => {
            this.props.history.push("/lobby");
        });
    }

    handleStartGame = () => {
        this.props.socket.emit("startGame", this.props.match.params.id);
    }

    handleSelectOpponent = (index) => {
        this.isThisPlayersTurn() && !this.state.mickProof && this.setState({selectedOpponent: index});
    }

    handleSelectCard = (index) => {
        this.isThisPlayersTurn() && !this.state.mickProof && this.setState({selectedCard: index});
    }

    handleAsk = () => {
        let payload = {
            askerID: this.state.thisPlayerID,
            cardID: this.state.thisPlayerHand[this.state.selectedCard].id,
            cardName: this.state.thisPlayerHand[this.state.selectedCard].name,
            responderID: this.state.players[this.state.selectedOpponent].id,
            gameID: this.props.match.params.id
        };
        this.props.socket.emit("ask", payload);
        this.setState({mickProof: true})
        this.clearSelections();
    }

    render() {
        if (this.state.gameStarted) {
            if (this.state.gameOver) {
                return <EndPage history={this.props.history} result={this.state.gameOver}/>;
            } else {
                return <Playing
                            players={this.state.players}
                            thisPlayer={this.state.players[this.state.players.length - 1]}
                            message={this.state.message}
                            cards={this.state.thisPlayerHand}
                            selectedOpponent={this.state.selectedOpponent}
                            selectedCard={this.state.selectedCard}
                            selectOpponentHandler={this.handleSelectOpponent}
                            selectCardHandler={this.handleSelectCard}
                            askHandler={this.askAllowed() ? this.handleAsk : null}
                            leaveHandler={this.handleLeaveGame}
                        />;
            }
        } else {
            return <GameLobby
                        creator={this.state.thisPlayerID === this.state.creator}
                        players={this.state.players}
                        handleCloseGame={this.handleCloseGame}
                        handleLeaveGame={this.handleLeaveGame}
                        handleStartGame={this.handleStartGame}
                    />
        }
    }
}


export default withSocket()(withAuth()(GameContainer));
