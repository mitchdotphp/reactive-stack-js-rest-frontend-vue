import _ from 'lodash';
import {Subject} from 'rxjs';
import {v4 as uuidv4} from 'uuid';
import ReconnectingWebSocket from 'reconnecting-websocket';

import Auth from './auth';

const WS_URI = process.env.VUE_APP_WS_URI;

const _path = () => {
	let path = _.trim(_.get(window, 'location.pathname', ''));
	if (_.startsWith(path, '/')) path = path.substr(1);
	return path;
};

export default class ClientSocket extends Subject {
	static _instance;
	static _socket;

	static _queue = [];
	static _subscriptions = {};

	static _onError = (err) => console.error(`[error] ${err.message}`);

	static _onClose = (e) => {
		if (e.wasClean) console.log(`[WS] Connection closed cleanly, code=${e.code} reason=${e.reason}`);
		else console.log('[WS] Connection crashed.');
	};

	static _onOpen = async (e) => {
		console.log('[WS] Connection open.');
		ClientSocket._socket = e.target;
		await ClientSocket.location(_path());

		_.each(ClientSocket._queue, ClientSocket.send);
		ClientSocket._queue = [];

		_.each(ClientSocket._subscriptions, ClientSocket.send);
	};

	static _onMessage = async (e) => {
		let {data: message} = e;
		message = JSON.parse(message);
		// console.log('[WS] Message received from server:', ClientSocket._socket.id, _.omit(message, 'payload'), Auth.loggedIn());
		console.log('[WS] Server message:', Auth.loggedIn(), ClientSocket._socket.id, message.type, message.target, message.payload);

		let {payload} = message;
		switch (message.type) {

			case 'ping':
				ClientSocket.send({
					...message,
					type: 'pong'
				});
				return;

			case 'socketId':
				ClientSocket._socket.id = message.socketId;
				await ClientSocket.authenticate();
				return;

			case 'refresh':
				Auth.refresh(payload);
				return;

			case 'update':
			case 'increment':
			case 'delete':
				if (!Auth.loggedIn()) return;
				ClientSocket._instance.next(message);
				return;

			default:
				return;
		}
	};

	static _connect = () => {
		console.log('[WS] Connecting...');
		ClientSocket._socket = new ReconnectingWebSocket(WS_URI);

		ClientSocket._socket.onopen = ClientSocket._onOpen;
		ClientSocket._socket.onclose = ClientSocket._onClose;
		ClientSocket._socket.onerror = ClientSocket._onError;
		ClientSocket._socket.onmessage = ClientSocket._onMessage;
	};

	static init() {
		if (!ClientSocket._instance) {
			ClientSocket._instance = new ClientSocket();
			ClientSocket._connect();
		}
		return ClientSocket._instance;
	}

	static async authenticate() {
		if (!Auth.loggedIn()) return;
		await ClientSocket.send({type: 'authenticate', jwt: Auth.jwt()});
	}

	static updateSubscription(message) {
		const {target} = message;
		ClientSocket._subscriptions[target] = {
			...message,
			type: 'subscribe'
		};
		ClientSocket.send(ClientSocket._subscriptions[target]);
	}

	static reloadData(target) {
		ClientSocket.send({target, type: 'reload'});
	}

	static closeSubscription(message) {
		const {target} = message;
		delete ClientSocket._subscriptions[target];

		ClientSocket.send({
			...message,
			type: 'unsubscribe'
		});
	}

	static send(message) {
		if (!message.id) message.id = uuidv4();
		if (!ClientSocket._socket || ClientSocket._socket.readyState !== WebSocket.OPEN) {
			ClientSocket._queue.push(message);
			return;
		}

		message = _.isString(message) ? message : JSON.stringify(message);
		return ClientSocket._socket.send(message);
	}

	static async location(path) {
		if (!ClientSocket._instance) {
			ClientSocket._instance = new ClientSocket();
			await ClientSocket._connect();
		}

		ClientSocket.send({
			type: 'location',
			path: path
		});
	}
}
