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
			<tr>${markup}</tr>
		</tbody>
	</table>
</div>
`;
}

const monthTemplate = markup => {
	return `\r				<td>${markup}</td>\r			`;
}

async function generateResultsIndex() {
	const htmlFiles = await glob('./results/*.html');

	let currentYear = '';
	let currentMonth = '';

	try {
		let markupToInsert = '';
		let yearMarkup = '';
		let monthMarkup = '';

		htmlFiles.forEach(path => {
			const fileName = path.replace('results/', '').replace('.html', '');
			let [year, month, day] = fileName.split('-');
			month = capitalizeFirstLetter(month);

			const dayMarkup = `\r					<a href="${path}">${month.slice(0, 3)} ${day}</a>\r				`;

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


		const data = fs.readFileSync('./results.html', 'utf8').replace(/(<\!-- @@@@@ ---start--- @@@@@ -->).*?(<\!-- @@@@@ ----end---- @@@@@ -->)/gms, (match, p1, p2) => {
			return p1 + markupToInsert + p2;
		});

		fs.writeFileSync('./results.html', data);

	} catch(e) {
		console.log('Error:', e.stack);
	}
}


generateResultsIndex();