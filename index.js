const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

async function GetAPIRequest() {
	//let response = await  axios.get('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
	//return response.data;
}

function getIssueNumber(core, context) {
	let issueNumber = core.getInput("issue-number");

	if (issueNumber) return issueNumber;

	issueNumber = context.payload.issue && context.payload.issue.number;
	if (issueNumber) return issueNumber;

	let card_url = context.payload.project_card && context.payload.project_card.content_url;
	issueNumber = card_url && card_url.split("/").pop();

	return issueNumber;
}

async function getIssue(issueNumber, owner, repo, api) {
	const res = await api.rest.issues.get({
		owner: owner,
		repo: repo,
		issue_number: issueNumber,
	});

	return res;
}

async function run() {
	console.log("run start");
	const org = core.getInput('org');
	const repo = core.getInput('repo');
	const token = core.getInput('token');
	const context = github.context;
	const issue_num = getIssueNumber(core, context);
	const repo_name = context.payload.repository.name;
  const owner_name = context.payload.repository.owner.login;
	const octokit = github.getOctokit(token);

	if (issue_num === undefined) {
		console.log("no issue number found");
		return "No issue number found, no action taken";
	}

	const { data: issue } = await octokit.rest.issues.get({
		owner: owner_name,
		repo: repo_name,
		issue_number: issue_num
	});

	if (!issue) {
		console.log("no issue found");
		return "No Issue found.";
	}

	const zendesk_id = getZendeskIdFromIssue(issue)
	const column = getProjectColumnFromContext(context);
	updateZendeskTicket(zendesk_id, column);

	console.log("run end");
	return "Job Completed";
}

function getZendeskIdFromIssue(issue) {
	if (!issue.title) {
		return 0;
	}
	const title_parts = issue.title.split('-');
	if(title_parts) {
		const zendesk_id = parseInt(title_parts[0]);
		if (isNaN(zendesk_id)) {
			return 0
		}

		return zendesk_id;
	}

	return 0;
}

// TODO: Solidy columns and expand these values
function getProjectColumnFromContext(context) {
	const columns = [
		{id: 15338077, name: "qa"}
		,{id: 15335031, name: "open"}
	];

	if (!context || !context.payload || !context.payload.project_card || !context.payload.project_card.column_id) {
		return "Cannot Find project_card or column_id in context";
	}

	const column_id = context.payload.project_card.column_id;
	const column = columns.filter(c => {
		return c.id == column_id;
	});

	console.log(column);
	return column[0];
}

function updateZendeskTicket(zenedsk_id, project_column) {
	if (project_column.name === 'qa')  {
		setZendeskTicketStatus(zendesk_id, project_column.name);
	}

	return;
}

function setZendeskTicketStatus(zendesk_id, zd_status) {
	console.log("status set to qa");
}

run() 
	.then(result => {
		console.log(result);
	}, err => {
		console.log(err);
	})
	.then(() => {
		process.exit();
	});
