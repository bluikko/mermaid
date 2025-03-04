import moment from 'moment';
import { sanitizeUrl } from '@braintree/sanitize-url';
import { log } from '../../logger';
import * as configApi from '../../config';
import utils from '../../utils';
import mermaidAPI from '../../mermaidAPI';

import {
  setAccTitle,
  getAccTitle,
  getAccDescription,
  setAccDescription,
  clear as commonClear,
  setDiagramTitle,
  getDiagramTitle,
} from '../../commonDb';

let dateFormat = '';
let axisFormat = '';
let tickInterval = undefined;
let todayMarker = '';
let includes = [];
let excludes = [];
let links = {};
let sections = [];
let tasks = [];
let currentSection = '';
const tags = ['active', 'done', 'crit', 'milestone'];
let funs = [];
let inclusiveEndDates = false;
let topAxis = false;

// The serial order of the task in the script
let lastOrder = 0;

export const parseDirective = function (statement, context, type) {
  mermaidAPI.parseDirective(this, statement, context, type);
};

export const clear = function () {
  sections = [];
  tasks = [];
  currentSection = '';
  funs = [];
  taskCnt = 0;
  lastTask = undefined;
  lastTaskID = undefined;
  rawTasks = [];
  dateFormat = '';
  axisFormat = '';
  tickInterval = undefined;
  todayMarker = '';
  includes = [];
  excludes = [];
  inclusiveEndDates = false;
  topAxis = false;
  lastOrder = 0;
  links = {};
  commonClear();
};

export const setAxisFormat = function (txt) {
  axisFormat = txt;
};

export const getAxisFormat = function () {
  return axisFormat;
};

export const setTickInterval = function (txt) {
  tickInterval = txt;
};

export const getTickInterval = function () {
  return tickInterval;
};

export const setTodayMarker = function (txt) {
  todayMarker = txt;
};

export const getTodayMarker = function () {
  return todayMarker;
};

export const setDateFormat = function (txt) {
  dateFormat = txt;
};

export const enableInclusiveEndDates = function () {
  inclusiveEndDates = true;
};

export const endDatesAreInclusive = function () {
  return inclusiveEndDates;
};

export const enableTopAxis = function () {
  topAxis = true;
};

export const topAxisEnabled = function () {
  return topAxis;
};

export const getDateFormat = function () {
  return dateFormat;
};

export const setIncludes = function (txt) {
  includes = txt.toLowerCase().split(/[\s,]+/);
};

export const getIncludes = function () {
  return includes;
};
export const setExcludes = function (txt) {
  excludes = txt.toLowerCase().split(/[\s,]+/);
};

export const getExcludes = function () {
  return excludes;
};

export const getLinks = function () {
  return links;
};

export const addSection = function (txt) {
  currentSection = txt;
  sections.push(txt);
};

export const getSections = function () {
  return sections;
};

export const getTasks = function () {
  let allItemsPricessed = compileTasks();
  const maxDepth = 10;
  let iterationCount = 0;
  while (!allItemsPricessed && iterationCount < maxDepth) {
    allItemsPricessed = compileTasks();
    iterationCount++;
  }

  tasks = rawTasks;

  return tasks;
};

export const isInvalidDate = function (date, dateFormat, excludes, includes) {
  if (includes.includes(date.format(dateFormat.trim()))) {
    return false;
  }
  if (date.isoWeekday() >= 6 && excludes.includes('weekends')) {
    return true;
  }
  if (excludes.includes(date.format('dddd').toLowerCase())) {
    return true;
  }
  return excludes.includes(date.format(dateFormat.trim()));
};

const checkTaskDates = function (task, dateFormat, excludes, includes) {
  if (!excludes.length || task.manualEndTime) {
    return;
  }
  let startTime = moment(task.startTime, dateFormat, true);
  startTime.add(1, 'd');
  let endTime = moment(task.endTime, dateFormat, true);
  let renderEndTime = fixTaskDates(startTime, endTime, dateFormat, excludes, includes);
  task.endTime = endTime.toDate();
  task.renderEndTime = renderEndTime;
};

const fixTaskDates = function (startTime, endTime, dateFormat, excludes, includes) {
  let invalid = false;
  let renderEndTime = null;
  while (startTime <= endTime) {
    if (!invalid) {
      renderEndTime = endTime.toDate();
    }
    invalid = isInvalidDate(startTime, dateFormat, excludes, includes);
    if (invalid) {
      endTime.add(1, 'd');
    }
    startTime.add(1, 'd');
  }
  return renderEndTime;
};

const getStartDate = function (prevTime, dateFormat, str) {
  str = str.trim();

  // Test for after
  const re = /^after\s+([\d\w- ]+)/;
  const afterStatement = re.exec(str.trim());

  if (afterStatement !== null) {
    // check all after ids and take the latest
    let latestEndingTask = null;
    afterStatement[1].split(' ').forEach(function (id) {
      let task = findTaskById(id);
      if (task !== undefined) {
        if (!latestEndingTask) {
          latestEndingTask = task;
        } else {
          if (task.endTime > latestEndingTask.endTime) {
            latestEndingTask = task;
          }
        }
      }
    });

    if (!latestEndingTask) {
      const dt = new Date();
      dt.setHours(0, 0, 0, 0);
      return dt;
    } else {
      return latestEndingTask.endTime;
    }
  }

  // Check for actual date set
  let mDate = moment(str, dateFormat.trim(), true);
  if (mDate.isValid()) {
    return mDate.toDate();
  } else {
    log.debug('Invalid date:' + str);
    log.debug('With date format:' + dateFormat.trim());
    const d = new Date(str);
    if (d === undefined || isNaN(d.getTime())) {
      throw new Error('Invalid date:' + str);
    }
    return d;
  }
};

/**
 * Parse a string as a moment duration.
 *
 * The string have to be compound by a value and a shorthand duration unit. For example `5d`
 * represents 5 days.
 *
 * Shorthand unit supported are:
 *
 * - `y` for years
 * - `M` for months
 * - `w` for weeks
 * - `d` for days
 * - `h` for hours
 * - `s` for seconds
 * - `ms` for milliseconds
 *
 * @param {string} str - A string representing the duration.
 * @returns {moment.Duration} A moment duration, including an invalid moment for invalid input
 *   string.
 */
const parseDuration = function (str) {
  const statement = /^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(str.trim());
  if (statement !== null) {
    return moment.duration(Number.parseFloat(statement[1]), statement[2]);
  }
  return moment.duration.invalid();
};

const getEndDate = function (prevTime, dateFormat, str, inclusive = false) {
  str = str.trim();

  // Check for actual date
  let mDate = moment(str, dateFormat.trim(), true);
  if (mDate.isValid()) {
    if (inclusive) {
      mDate.add(1, 'd');
    }
    return mDate.toDate();
  }

  const endTime = moment(prevTime);
  const duration = parseDuration(str);
  if (duration.isValid()) {
    endTime.add(duration);
  }
  return endTime.toDate();
};

let taskCnt = 0;
const parseId = function (idStr) {
  if (idStr === undefined) {
    taskCnt = taskCnt + 1;
    return 'task' + taskCnt;
  }
  return idStr;
};
// id, startDate, endDate
// id, startDate, length
// id, after x, endDate
// id, after x, length
// startDate, endDate
// startDate, length
// after x, endDate
// after x, length
// endDate
// length

const compileData = function (prevTask, dataStr) {
  let ds;

  if (dataStr.substr(0, 1) === ':') {
    ds = dataStr.substr(1, dataStr.length);
  } else {
    ds = dataStr;
  }

  const data = ds.split(',');

  const task = {};

  // Get tags like active, done, crit and milestone
  getTaskTags(data, task, tags);

  for (let i = 0; i < data.length; i++) {
    data[i] = data[i].trim();
  }

  let endTimeData = '';
  switch (data.length) {
    case 1:
      task.id = parseId();
      task.startTime = prevTask.endTime;
      endTimeData = data[0];
      break;
    case 2:
      task.id = parseId();
      task.startTime = getStartDate(undefined, dateFormat, data[0]);
      endTimeData = data[1];
      break;
    case 3:
      task.id = parseId(data[0]);
      task.startTime = getStartDate(undefined, dateFormat, data[1]);
      endTimeData = data[2];
      break;
    default:
  }

  if (endTimeData) {
    task.endTime = getEndDate(task.startTime, dateFormat, endTimeData, inclusiveEndDates);
    task.manualEndTime = moment(endTimeData, 'YYYY-MM-DD', true).isValid();
    checkTaskDates(task, dateFormat, excludes, includes);
  }

  return task;
};

const parseData = function (prevTaskId, dataStr) {
  let ds;
  if (dataStr.substr(0, 1) === ':') {
    ds = dataStr.substr(1, dataStr.length);
  } else {
    ds = dataStr;
  }

  const data = ds.split(',');

  const task = {};

  // Get tags like active, done, crit and milestone
  getTaskTags(data, task, tags);

  for (let i = 0; i < data.length; i++) {
    data[i] = data[i].trim();
  }

  switch (data.length) {
    case 1:
      task.id = parseId();
      task.startTime = {
        type: 'prevTaskEnd',
        id: prevTaskId,
      };
      task.endTime = {
        data: data[0],
      };
      break;
    case 2:
      task.id = parseId();
      task.startTime = {
        type: 'getStartDate',
        startData: data[0],
      };
      task.endTime = {
        data: data[1],
      };
      break;
    case 3:
      task.id = parseId(data[0]);
      task.startTime = {
        type: 'getStartDate',
        startData: data[1],
      };
      task.endTime = {
        data: data[2],
      };
      break;
    default:
  }

  return task;
};

let lastTask;
let lastTaskID;
let rawTasks = [];
const taskDb = {};
export const addTask = function (descr, data) {
  const rawTask = {
    section: currentSection,
    type: currentSection,
    processed: false,
    manualEndTime: false,
    renderEndTime: null,
    raw: { data: data },
    task: descr,
    classes: [],
  };
  const taskInfo = parseData(lastTaskID, data);
  rawTask.raw.startTime = taskInfo.startTime;
  rawTask.raw.endTime = taskInfo.endTime;
  rawTask.id = taskInfo.id;
  rawTask.prevTaskId = lastTaskID;
  rawTask.active = taskInfo.active;
  rawTask.done = taskInfo.done;
  rawTask.crit = taskInfo.crit;
  rawTask.milestone = taskInfo.milestone;
  rawTask.order = lastOrder;

  lastOrder++;

  const pos = rawTasks.push(rawTask);

  lastTaskID = rawTask.id;
  // Store cross ref
  taskDb[rawTask.id] = pos - 1;
};

export const findTaskById = function (id) {
  const pos = taskDb[id];
  return rawTasks[pos];
};

export const addTaskOrg = function (descr, data) {
  const newTask = {
    section: currentSection,
    type: currentSection,
    description: descr,
    task: descr,
    classes: [],
  };
  const taskInfo = compileData(lastTask, data);
  newTask.startTime = taskInfo.startTime;
  newTask.endTime = taskInfo.endTime;
  newTask.id = taskInfo.id;
  newTask.active = taskInfo.active;
  newTask.done = taskInfo.done;
  newTask.crit = taskInfo.crit;
  newTask.milestone = taskInfo.milestone;
  lastTask = newTask;
  tasks.push(newTask);
};

const compileTasks = function () {
  const compileTask = function (pos) {
    const task = rawTasks[pos];
    let startTime = '';
    switch (rawTasks[pos].raw.startTime.type) {
      case 'prevTaskEnd': {
        const prevTask = findTaskById(task.prevTaskId);
        task.startTime = prevTask.endTime;
        break;
      }
      case 'getStartDate':
        startTime = getStartDate(undefined, dateFormat, rawTasks[pos].raw.startTime.startData);
        if (startTime) {
          rawTasks[pos].startTime = startTime;
        }
        break;
    }

    if (rawTasks[pos].startTime) {
      rawTasks[pos].endTime = getEndDate(
        rawTasks[pos].startTime,
        dateFormat,
        rawTasks[pos].raw.endTime.data,
        inclusiveEndDates
      );
      if (rawTasks[pos].endTime) {
        rawTasks[pos].processed = true;
        rawTasks[pos].manualEndTime = moment(
          rawTasks[pos].raw.endTime.data,
          'YYYY-MM-DD',
          true
        ).isValid();
        checkTaskDates(rawTasks[pos], dateFormat, excludes, includes);
      }
    }

    return rawTasks[pos].processed;
  };

  let allProcessed = true;
  for (const [i, rawTask] of rawTasks.entries()) {
    compileTask(i);

    allProcessed = allProcessed && rawTask.processed;
  }
  return allProcessed;
};

/**
 * Called by parser when a link is found. Adds the URL to the vertex data.
 *
 * @param ids Comma separated list of ids
 * @param _linkStr URL to create a link for
 */
export const setLink = function (ids, _linkStr) {
  let linkStr = _linkStr;
  if (configApi.getConfig().securityLevel !== 'loose') {
    linkStr = sanitizeUrl(_linkStr);
  }
  ids.split(',').forEach(function (id) {
    let rawTask = findTaskById(id);
    if (rawTask !== undefined) {
      pushFun(id, () => {
        window.open(linkStr, '_self');
      });
      links[id] = linkStr;
    }
  });
  setClass(ids, 'clickable');
};

/**
 * Called by parser when a special node is found, e.g. a clickable element.
 *
 * @param ids Comma separated list of ids
 * @param className Class to add
 */
export const setClass = function (ids, className) {
  ids.split(',').forEach(function (id) {
    let rawTask = findTaskById(id);
    if (rawTask !== undefined) {
      rawTask.classes.push(className);
    }
  });
};

const setClickFun = function (id, functionName, functionArgs) {
  if (configApi.getConfig().securityLevel !== 'loose') {
    return;
  }
  if (functionName === undefined) {
    return;
  }

  let argList = [];
  if (typeof functionArgs === 'string') {
    /* Splits functionArgs by ',', ignoring all ',' in double quoted strings */
    argList = functionArgs.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    for (let i = 0; i < argList.length; i++) {
      let item = argList[i].trim();
      /* Removes all double quotes at the start and end of an argument */
      /* This preserves all starting and ending whitespace inside */
      if (item.charAt(0) === '"' && item.charAt(item.length - 1) === '"') {
        item = item.substr(1, item.length - 2);
      }
      argList[i] = item;
    }
  }

  /* if no arguments passed into callback, default to passing in id */
  if (argList.length === 0) {
    argList.push(id);
  }

  let rawTask = findTaskById(id);
  if (rawTask !== undefined) {
    pushFun(id, () => {
      utils.runFunc(functionName, ...argList);
    });
  }
};

/**
 * The callbackFunction is executed in a click event bound to the task with the specified id or the
 * task's assigned text
 *
 * @param id The task's id
 * @param callbackFunction A function to be executed when clicked on the task or the task's text
 */
const pushFun = function (id, callbackFunction) {
  funs.push(
    function () {
      // const elem = d3.select(element).select(`[id="${id}"]`)
      const elem = document.querySelector(`[id="${id}"]`);
      if (elem !== null) {
        elem.addEventListener('click', function () {
          callbackFunction();
        });
      }
    },
    function () {
      // const elem = d3.select(element).select(`[id="${id}-text"]`)
      const elem = document.querySelector(`[id="${id}-text"]`);
      if (elem !== null) {
        elem.addEventListener('click', function () {
          callbackFunction();
        });
      }
    }
  );
};

/**
 * Called by parser when a click definition is found. Registers an event handler.
 *
 * @param ids Comma separated list of ids
 * @param functionName Function to be called on click
 * @param functionArgs Function args the function should be called with
 */
export const setClickEvent = function (ids, functionName, functionArgs) {
  ids.split(',').forEach(function (id) {
    setClickFun(id, functionName, functionArgs);
  });
  setClass(ids, 'clickable');
};

/**
 * Binds all functions previously added to fun (specified through click) to the element
 *
 * @param element
 */
export const bindFunctions = function (element) {
  funs.forEach(function (fun) {
    fun(element);
  });
};

export default {
  parseDirective,
  getConfig: () => configApi.getConfig().gantt,
  clear,
  setDateFormat,
  getDateFormat,
  enableInclusiveEndDates,
  endDatesAreInclusive,
  enableTopAxis,
  topAxisEnabled,
  setAxisFormat,
  getAxisFormat,
  setTickInterval,
  getTickInterval,
  setTodayMarker,
  getTodayMarker,
  setAccTitle,
  getAccTitle,
  setDiagramTitle,
  getDiagramTitle,
  setAccDescription,
  getAccDescription,
  addSection,
  getSections,
  getTasks,
  addTask,
  findTaskById,
  addTaskOrg,
  setIncludes,
  getIncludes,
  setExcludes,
  getExcludes,
  setClickEvent,
  setLink,
  getLinks,
  bindFunctions,
  parseDuration,
  isInvalidDate,
};

/**
 * @param data
 * @param task
 * @param tags
 */
function getTaskTags(data, task, tags) {
  let matchFound = true;
  while (matchFound) {
    matchFound = false;
    tags.forEach(function (t) {
      const pattern = '^\\s*' + t + '\\s*$';
      const regex = new RegExp(pattern);
      if (data[0].match(regex)) {
        task[t] = true;
        data.shift(1);
        matchFound = true;
      }
    });
  }
}
