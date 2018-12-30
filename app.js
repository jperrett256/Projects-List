const express = require('express');
const path = require('path');
const app = express();
const port = process.argv[2];

/* Handle database requests */
const nano = require('nano')('http://localhost:5984');
const db = nano.db.use('projects_list');

/* Serve the main content */
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'index.html'));
});

/* Provide list of all projects */
app.get('/projects_list', function(req, res) {
	db.list({include_docs: true}).then(function(body) {
		var result = {};
		body.rows.forEach(function(doc) {
			var item = doc.doc;
			delete item['_rev'];
			result[item.prev ? item._id : '_start'] = item;
		});
		res.json(result);
	});
});

/* Middleware for post requests */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/edit_item', function(req, res) {
	var item = req.body;

	db.get(item._id).then(function(body) {
		body.name = item.name;
		body.description = item.description;
		return db.insert(body);
	}).then(function() {
		res.json({ message: 'OK' });
	}).catch(function(error) {
		// res.sendStatus(500);
		res.status(500).json({
			message: 'failed to edit item'
		});
	});
})

/* Change order of items in list */
app.post('/new_position', function(req, res) {
	var item = req.body;	// information about the moved item

	db.get(item._id).then(function(original) {
		return Promise.resolve().then(function () {
			let promises = [];
			/* Update item before starting position */
			if (original.prev) promises.push(db.get(original.prev).then(function(body) {
				body.next = original.next;
				return db.insert(body);
			}));
			/* Update item after starting position */
			if (original.next) promises.push(db.get(original.next).then(function(body) {
				body.prev = original.prev;
				return db.insert(body);
			}));
			return Promise.all(promises);
		}).then(function() {
			let promises = [];
			/* Update item before finishing position */
			if (item.prev) promises.push(db.get(item.prev).then(function(body) {
				body.next = item._id;
				return db.insert(body);
			}));
			/* Update item after finishing position */
			if (item.next) promises.push(db.get(item.next).then(function(body) {
				body.prev = item._id;
				return db.insert(body);
			}));
			/* Update original */
			original.prev = item.prev;
			original.next = item.next;
			promises.push(db.insert(original));

			return Promise.all(promises);
		});
	}).then(function() {
		res.json({ message: 'OK' });
	}).catch(function() {
		res.status(500).json({
			message: 'failed to update order'
		});
	});

	/* The first pair of inserts must happen before the second pair of get requests.
	 * This is because original.prev == item.next or original.next == item.prev
	 * results in a conflict unless the database is updated before it is read again. */

	/* Check out of sync? => in sync if get(item.prev).next == item.next
	 * && get(item.next).prev == item.prev */
});

app.post('/add_item', function(req, res) {
	var item = req.body;

	// let promises = [];
	// promises.push(nano.get('_uuids').then(function(body) {
	// 	return body.uuids[0];
	// }));
	// promises.push(item.prev ? db.get(item.prev) : null);
	// promises.push(item.next ? db.get(item.next) : null);

	// Promise.all(promises).then(results) {
	//  let [id, prev, next] = results;
	// 	item._id = id;
	// 	let promises = [ db.insert(item) ];
	// 	if (prev) {
	// 		prev.next = id;
	// 		promises.push(db.insert(prev));
	// 	}
	// 	if (next) {
	// 		next.prev = id;
	// 		promises.push(db.insert(next))
	// 	}
	// 	return Promise.all(promises);
	// }
	/* TODO this method would allow us to check if the data
	 * is in sync */

	nano.request({ db: '_uuids' }).then(function(body) {
		item._id = body.uuids[0];
		let promises = [];

		promises.push(db.insert(item));

		if (item.prev) promises.push(db.get(item.prev).then(function(body) {
			body.next = item._id;
			return db.insert(body);
		}));

		if (item.next) promises.push(db.get(item.next).then(function(body) {
			body.prev = item._id;
			return db.insert(body);
		}));

		return Promise.all(promises);
	}).then(function() {
		res.json({
			message: 'OK',
			_id: item._id 	// return new id
		});
	}).catch(function(error) {
		res.status(500).json({ message: 'failed to add item' });
	});

	/* Should new ids be handled on the client-side?
	 * It could make certain aspects easier (possibly).
	 * No need to pass an id from server to client.
	 * Would just need to a quick check on the server (using regex).
	 * In the end, it may not be worth it.
	 */
});

app.post('/delete_item', function (req, res) {
	var item = req.body;
	let promises = [];

	promises.push(item.prev ? db.get(item.prev) : null);
	promises.push(item.next ? db.get(item.next) : null);
	promises.push(db.get(item._id));

	Promise.all(promises).then(function(results) {
		let [prev, next, current] = results;
		let promises = [];

		if (prev) {
			prev.next = next ? next._id : null;
			promises.push(db.insert(prev));
		}
		if (next) {
			next.prev = prev ? prev._id : null;
			promises.push(db.insert(next));
		}
		promises.push(db.destroy(current._id, current._rev));

		return Promise.all(promises);
	}).then(function() {
		res.json({ message: 'OK' });
	}).catch(function(error) {
		console.log(error);
		res.status(500).json({ message: 'failed to delete item' });
	})
});

app.listen(port, function (err) {
	if (err) return console.error(err);
	console.log(`Server listening on port ${port}.`);
});
