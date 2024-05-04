const { glob } = require('glob');
const fs = require('fs');

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const yearTemplate = (year, markup) => {
	return `
		<div class="year">
			<h2>&nbsp; ${year}</h2>
			<table width="100%">
				<thead>
					<tr>
						<th>January</th>
						<th>February</th>
						<th>March</th>
						<th>April</th>
						<th>May</th>
						<th>June</th>
						<th>July</th>
						<th>August</th>
						<th>September</th>
						<th>October</th>
						<th>November</th>
						<th>December</th>
					</tr>
				</thead>
				<tbody>
					<tr>
					${markup}
					</tr>
				</tbody>
			</table>
		</div>
	`;
}

const monthTemplate = markup => {
	return `
		<td>${markup}</td>
	`;
}

async function init() {
	const htmlFiles = await glob('./results/*.html');

	console.log(htmlFiles);

	let currentYear = '';
	let currentMonth = '';

	try {
		let markupToInsert = '';
		let yearMarkup = '';
		let monthMarkup = '';

		htmlFiles.forEach(path => {
			// const data = fs.readFileSync(file, 'utf8');
			// console.log(data);

			const fileName = path.replace('results/', '').replace('.html', '');
			let [year, month, day] = fileName.split('-');
			month = capitalizeFirstLetter(month);

			const dayMarkup = `<a href="${path}">${month.slice(0, 3)} ${day}</a>`;

			if(month !== currentMonth && currentMonth) {
				yearMarkup += monthTemplate(monthMarkup);
				monthMarkup = '';
			}

			if(year !== currentYear && currentYear) {
				markupToInsert += yearTemplate(currentYear, yearMarkup);
				yearMarkup = '';
			}

			monthMarkup += dayMarkup;
			currentYear = year;
			currentMonth = month;
		});

		// last year / last month
		yearMarkup += monthTemplate(monthMarkup);
		markupToInsert += yearTemplate(currentYear, yearMarkup);

		console.log(markupToInsert);

		const commentStart = "<!-- ***** GENERATED RESULTS INSERTED FROM HERE -- DON'T DELETE/EDIT THIS COMMENT! ***** -->";
		const commentEnd = "<!-- ***** GENERATED RESULTS INSERTED TO HERE -- DON'T DELETE/EDIT THIS COMMENT! ***** -->";

		const data = fs.readFileSync('./results.html', 'utf8').replace(commentStart, commentStart + '\r' + markupToInsert);

		try {
			fs.writeFileSync('./results.html', data);
			// file written successfully
		} catch (err) {
			console.error(err);
		}





	} catch(e) {
		console.log('Error:', e.stack);
	}
}


init();