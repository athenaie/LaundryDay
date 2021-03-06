import React, { Component } from "react";

import { withSocket } from "../../SocketContext/SocketContext";
import LoginToContinue from "../../../components/LoginToContinue/LoginToContinue";

class AuthHandler extends Component {
    componentDidMount() {
        if (!this.props.socketAuth.isAuthenticated) {
            let googleUser = this.props.gAuth.currentUser.get();
            // console.log('Logged in as: ' + googleUser.getBasicProfile().getName());
            this.props.socket.emit("authenticate", googleUser.getAuthResponse().id_token, (response) => {
                // console.log(response);
                // console.log(this.props.socket);

                this.props.socketAuth.updateAuthStatus(true);
                
                switch (response.goTo) {
                    case "avatar":
                        this.props.history.replace("/avatar");
                        break;
                    case "game":
                        this.props.history.replace("/game/" + response.id);
                        break;
                    case "home":
                        if (this.props.match.url !== "/lobby" && this.props.match.url === "/avatar") {
                            this.props.history.replace("/home");
                        }
                        break;
                    default:
                        // do not re-route
                        break;
                }
            });
        }
    }

    render() {
        if (this.props.socketAuth.isAuthenticated) {
            return this.props.children;
        } else {
            return <LoginToContinue loading={true}/>;
        }
    }
}

export default withSocket()(AuthHandler);
