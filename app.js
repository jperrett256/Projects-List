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
app.use(express.urlencoded({
	extended: true
}));

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
		res.json({ status: "ok" });
	});

	/* The first pair of inserts must happen before the second pair of get requests.
	 * This is because original.prev == item.next or original.next == item.prev
	 * results in a conflict unless the database is updated before it is read again. */

	/* TODO error handling?
	 * Check out of sync? => in sync if get(item.prev).next == item.next
	 * && get(item.next).prev == item.prev */
});

app.listen(port, function (err) {
	if (err) return console.error(err);
	console.log(`Server listening on port ${port}.`);
});
